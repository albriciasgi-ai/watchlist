// src/components/indicators/SupportResistanceIndicator.js
// Support & Resistance Indicator con niveles detectados por volumen

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class SupportResistanceIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 60) {
    super(symbol, interval, days);
    this.name = "Support & Resistance";
    this.height = 0; // No ocupa espacio propio, se dibuja sobre el chart
    this.days = days;

    // 🎯 FIX v2: Empezar habilitado por defecto, fetchData se llamará en initialize()
    // this.enabled ya es true por defecto en IndicatorBase

    console.log(`%c[SupportResistanceIndicator] VERSION 1.3 LOADED - WITH LOCAL CALCULATION`, 'background: #4CAF50; color: white; font-weight: bold; padding: 4px;');

    // Configuración
    this.volumeMethod = "zscore";
    this.zScoreThreshold = 1.0;
    this.zScorePeriod = 50;
    this.leftBars = 12;
    this.rightBars = 12;
    this.minTouches = 2;
    this.clusterDistance = 0.5;
    this.maxLevels = 20;

    // Visualización
    this.showResistances = true;
    this.showSupports = true;
    this.showConsolidationZones = true;
    this.showLabels = true;
    this.lineWidth = 2;

    // Datos
    this.resistances = [];
    this.supports = [];
    this.consolidationZones = [];
    this.currentPrice = 0;

    // 🎯 NUEVO: Control de cálculo local para backtesting
    this._lastCalculatedLength = 0;
    this._calculationValid = false;

    // 🎯 Control de playback time para evitar sesgo de supervivencia
    this._currentPlaybackTime = null;
    this._lastPlaybackTime = null;

    // Flags de logging
    this._renderLoggedOnce = false;
    this._noDataLoggedOnce = false;
    this._fallbackLoggedOnce = false;

    // 🎯 NUEVO: Caché en IndexedDB
    this._dbName = 'SupportResistanceCache';
    this._storeName = 'levels';
    this._dbVersion = 1;
    this._cachedRawLevels = null; // Niveles sin filtrar por activo/roto
  }

  // ==================== IndexedDB Cache Methods ====================

  /**
   * Abre conexión a IndexedDB
   */
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

  /**
   * Genera la clave de caché basada en símbolo, intervalo y parámetros
   */
  _getCacheKey() {
    return `sr_${this.symbol}_${this.interval}`;
  }

  /**
   * Genera un hash de los parámetros de cálculo
   */
  _getParamsHash() {
    return JSON.stringify({
      leftBars: this.leftBars,
      rightBars: this.rightBars,
      minTouches: this.minTouches,
      clusterDistance: this.clusterDistance
    });
  }

  /**
   * Guarda niveles calculados en IndexedDB
   */
  async _saveLevelsToCache(resistances, supports, candlesLength) {
    try {
      const db = await this._openDB();
      const transaction = db.transaction([this._storeName], 'readwrite');
      const store = transaction.objectStore(this._storeName);

      const cacheData = {
        key: this._getCacheKey(),
        paramsHash: this._getParamsHash(),
        candlesLength: candlesLength,
        resistances: resistances,
        supports: supports,
        calculatedAt: Date.now()
      };

      store.put(cacheData);

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });

      console.log(`[${this.symbol}] 💾 S&R: Caché guardado en IndexedDB (${resistances.length} R, ${supports.length} S)`);
      db.close();
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R: Error guardando en IndexedDB:`, error);
    }
  }

  /**
   * Carga niveles desde IndexedDB si el caché es válido
   * @returns {object|null} - { resistances, supports } o null si no hay caché válido
   */
  async _loadLevelsFromCache(candlesLength) {
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
        console.log(`[${this.symbol}] 📭 S&R: No hay caché en IndexedDB`);
        return null;
      }

      // Verificar si los parámetros coinciden
      if (result.paramsHash !== this._getParamsHash()) {
        console.log(`[${this.symbol}] 🔄 S&R: Parámetros cambiaron, invalidando caché`);
        return null;
      }

      // Verificar si la cantidad de velas es compatible (permite pequeñas diferencias)
      const lengthDiff = Math.abs(result.candlesLength - candlesLength);
      const maxAllowedDiff = Math.max(10, candlesLength * 0.01); // 1% o mínimo 10 velas

      if (lengthDiff > maxAllowedDiff) {
        console.log(`[${this.symbol}] 🔄 S&R: Cantidad de velas cambió significativamente (${result.candlesLength} → ${candlesLength}), invalidando caché`);
        return null;
      }

      const ageMinutes = ((Date.now() - result.calculatedAt) / 1000 / 60).toFixed(1);
      console.log(`[${this.symbol}] ✅ S&R: Usando caché de IndexedDB (edad: ${ageMinutes} min, ${result.resistances.length} R, ${result.supports.length} S)`);

      return {
        resistances: result.resistances,
        supports: result.supports
      };
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R: Error leyendo IndexedDB:`, error);
      return null;
    }
  }

  /**
   * Invalida el caché (llamar cuando cambian parámetros)
   */
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

      console.log(`[${this.symbol}] 🗑️ S&R: Caché invalidado`);
      db.close();
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R: Error invalidando caché:`, error);
    }
  }

  /**
   * Fetch Support & Resistance data from backend
   */
  async fetchData() {
    console.log(`%c[${this.symbol}] 📊 S/R fetchData CALLED`, 'background: #2196F3; color: white; font-weight: bold; padding: 2px 4px;');
    console.log(`[${this.symbol}] S/R config: interval=${this.interval}, days=${this.days}, enabled=${this.enabled}`);

    try {
      const params = new URLSearchParams({
        interval: this.interval,
        days: this.days.toString(),
        volume_method: this.volumeMethod,
        z_score_threshold: this.zScoreThreshold.toString(),
        z_score_period: this.zScorePeriod.toString(),
        left_bars: this.leftBars.toString(),
        right_bars: this.rightBars.toString(),
        min_touches: this.minTouches.toString(),
        cluster_distance: this.clusterDistance.toString(),
        max_levels: this.maxLevels.toString()
      });

      const url = `${API_BASE_URL}/api/support-resistance/${this.symbol}?${params}`;
      console.log(`[${this.symbol}] 📊 S/R: Fetching from ${url}`);

      const response = await fetch(url);
      console.log(`[${this.symbol}] S/R response status: ${response.status}`);
      const result = await response.json();
      console.log(`[${this.symbol}] S/R response:`, result);

      if (result.success && result.data) {
        this.resistances = result.data.resistances || [];
        this.supports = result.data.supports || [];
        this.consolidationZones = result.data.consolidationZones || [];
        this.currentPrice = result.data.currentPrice || 0;

        console.log(`%c[${this.symbol}] ✅ S/R loaded: ${this.resistances.length} resistances, ${this.supports.length} supports, ${this.consolidationZones.length} zones`, 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;');

        // Check for price alerts
        this.checkPriceAlerts(this.currentPrice);

        return true;
      } else {
        console.warn(`[${this.symbol}] ⚠️ No S/R data available - success=${result.success}, hasData=${!!result.data}`);
        if (result.error) console.error(`[${this.symbol}] S/R error: ${result.error}`);
        this.clearData();
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching S/R:`, error);
      this.clearData();
      return false;
    }
  }

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.consolidationZones = [];
    this.currentPrice = 0;
    this._calculationValid = false;
  }

  /**
   * 🎯 Actualiza el tiempo de playback (llamado desde BacktestingApp)
   * Invalida el cálculo si el tiempo cambió significativamente
   */
  updatePlaybackDate(timestamp) {
    this._currentPlaybackTime = timestamp;

    // Recalcular si el playback avanzó más de 1 vela (estimado)
    if (this._lastPlaybackTime && timestamp !== this._lastPlaybackTime) {
      this._calculationValid = false;
      this._renderLoggedOnce = false;
      this._noDataLoggedOnce = false;
      this._fallbackLoggedOnce = false;
    }
    this._lastPlaybackTime = timestamp;
  }

  /**
   * 🎯 PARTE 1: Cálculo PESADO de niveles (pivots + clustering + filtro toques)
   * Esto es lo que se cachea en IndexedDB
   * @param {Array} candles - Array de velas
   * @returns {object} - { resistances, supports } sin clasificar activo/roto
   */
  _calculateRawLevels(candles) {
    const startTime = Date.now();

    // 1. Encontrar pivots (máximos y mínimos locales)
    const pivotHighs = [];
    const pivotLows = [];

    for (let i = this.leftBars; i < candles.length - this.rightBars; i++) {
      const candle = candles[i];

      // Verificar si es un pivot high (máximo local)
      let isHighPivot = true;
      for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
        if (j !== i && candles[j].high >= candle.high) {
          isHighPivot = false;
          break;
        }
      }
      if (isHighPivot) {
        pivotHighs.push({
          price: candle.high,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }

      // Verificar si es un pivot low (mínimo local)
      let isLowPivot = true;
      for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
        if (j !== i && candles[j].low <= candle.low) {
          isLowPivot = false;
          break;
        }
      }
      if (isLowPivot) {
        pivotLows.push({
          price: candle.low,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }
    }

    // 2. Agrupar pivots cercanos (clustering)
    const clusterPivots = (pivots, type) => {
      if (pivots.length === 0) return [];

      const sorted = [...pivots].sort((a, b) => a.price - b.price);
      const clusters = [];
      let currentCluster = [sorted[0]];

      for (let i = 1; i < sorted.length; i++) {
        const priceDiff = Math.abs(sorted[i].price - currentCluster[0].price) / currentCluster[0].price * 100;

        if (priceDiff <= this.clusterDistance) {
          currentCluster.push(sorted[i]);
        } else {
          clusters.push(currentCluster);
          currentCluster = [sorted[i]];
        }
      }
      clusters.push(currentCluster);

      return clusters.map(cluster => {
        const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
        const totalVolume = cluster.reduce((sum, p) => sum + p.volume, 0);
        const touches = cluster.length;

        return {
          price: avgPrice,
          touches: touches,
          strength: Math.min(10, touches * 2 + (totalVolume > 0 ? 2 : 0)),
          type: type
        };
      });
    };

    // 3. Crear niveles
    let resistances = clusterPivots(pivotHighs, 'resistance');
    let supports = clusterPivots(pivotLows, 'support');

    // 4. Filtrar por toques mínimos
    resistances = resistances.filter(r => r.touches >= this.minTouches);
    supports = supports.filter(s => s.touches >= this.minTouches);

    const duration = Date.now() - startTime;
    console.log(`[${this.symbol}] 📊 S&R: Cálculo pesado completado en ${duration}ms (${resistances.length} R, ${supports.length} S de ${candles.length} velas)`);

    return { resistances, supports };
  }

  /**
   * 🎯 PARTE 2: Clasificación RÁPIDA de niveles (activo/roto según precio actual)
   * Esto se ejecuta cada vez, es muy rápido
   * @param {object} rawLevels - { resistances, supports } sin clasificar
   * @param {Array} candles - Velas para determinar precio actual y niveles rotos
   */
  _classifyLevels(rawLevels, candles) {
    const { resistances, supports } = rawLevels;

    // Precio actual
    const lastCandle = candles[candles.length - 1];
    this.currentPrice = lastCandle.close;

    // Determinar niveles rotos (precio pasó recientemente)
    const recentBarsForBreak = Math.min(50, Math.floor(candles.length * 0.1));
    const recentCandles = candles.slice(-recentBarsForBreak);
    const recentHigh = Math.max(...recentCandles.map(c => c.high));
    const recentLow = Math.min(...recentCandles.map(c => c.low));

    // Clasificar resistencias
    const classifiedResistances = resistances.map(r => ({
      ...r,
      isBroken: recentHigh > r.price,
      isAbovePrice: r.price > this.currentPrice
    }));

    // Clasificar soportes
    const classifiedSupports = supports.map(s => ({
      ...s,
      isBroken: recentLow < s.price,
      isBelowPrice: s.price < this.currentPrice
    }));

    // Separar y ordenar por proximidad
    const activeResistances = classifiedResistances
      .filter(r => r.isAbovePrice && !r.isBroken)
      .map(r => ({ ...r, distanceToPrice: r.price - this.currentPrice }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    const brokenResistances = classifiedResistances
      .filter(r => r.isAbovePrice && r.isBroken)
      .map(r => ({ ...r, distanceToPrice: r.price - this.currentPrice }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    const activeSupports = classifiedSupports
      .filter(s => s.isBelowPrice && !s.isBroken)
      .map(s => ({ ...s, distanceToPrice: this.currentPrice - s.price }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    const brokenSupports = classifiedSupports
      .filter(s => s.isBelowPrice && s.isBroken)
      .map(s => ({ ...s, distanceToPrice: this.currentPrice - s.price }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    // Limitar y combinar
    const finalResistances = [
      ...activeResistances.slice(0, this.maxLevels).map(r => ({ ...r, status: 'active' })),
      ...brokenResistances.slice(0, this.maxLevels).map(r => ({ ...r, status: 'broken' }))
    ];

    const finalSupports = [
      ...activeSupports.slice(0, this.maxLevels).map(s => ({ ...s, status: 'active' })),
      ...brokenSupports.slice(0, this.maxLevels).map(s => ({ ...s, status: 'broken' }))
    ];

    // Guardar resultados
    this.resistances = finalResistances;
    this.supports = finalSupports;
    this.consolidationZones = [];
  }

  /**
   * 🎯 NUEVO: Calcula S&R con soporte de caché IndexedDB
   * @param {Array} candles - Array de velas con formato {timestamp, open, high, low, close, volume}
   */
  async calculateFromCandles(candles) {
    if (!candles || candles.length < this.leftBars + this.rightBars + 1) {
      console.warn(`[${this.symbol}] S&R calculateFromCandles: No hay suficientes velas (${candles?.length || 0})`);
      return;
    }

    console.log(`[${this.symbol}] 📊 S&R: Procesando ${candles.length} velas (params: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches})`);

    let rawLevels = null;

    // 1. Intentar cargar desde caché
    if (!this._cachedRawLevels) {
      const cached = await this._loadLevelsFromCache(candles.length);
      if (cached) {
        rawLevels = cached;
        this._cachedRawLevels = cached;
      }
    } else {
      // Ya tenemos caché en memoria
      rawLevels = this._cachedRawLevels;
      console.log(`[${this.symbol}] ⚡ S&R: Usando caché en memoria`);
    }

    // 2. Si no hay caché válido, calcular
    if (!rawLevels) {
      console.log(`[${this.symbol}] 🔄 S&R: Calculando niveles (sin caché)...`);
      rawLevels = this._calculateRawLevels(candles);
      this._cachedRawLevels = rawLevels;

      // Guardar en IndexedDB (async, no bloqueante)
      this._saveLevelsToCache(rawLevels.resistances, rawLevels.supports, candles.length);
    }

    // 3. Clasificar según precio actual (siempre se ejecuta, es rápido)
    this._classifyLevels(rawLevels, candles);

    this._lastCalculatedLength = candles.length;
    this._calculationValid = true;

    console.log(`[${this.symbol}] ✅ S&R: ${this.resistances.length} R, ${this.supports.length} S (precio actual: $${this.currentPrice.toFixed(2)})`);
  }

  /**
   * Renderiza los niveles de S/R sobre el precio (main chart)
   * IMPORTANTE: Este método se llama desde IndicatorManager.renderOverlays()
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) return;

    // 🎯 NUEVO: Calcular S&R localmente si tenemos velas (modo backtesting)
    if (allCandles && allCandles.length > 0) {
      // Filtrar velas hasta el playback time para evitar sesgo de supervivencia
      let candlesToUse = allCandles;

      // 🎯 FIX: Si no hay playbackTime pero hay visibleCandles, usar la última visible como referencia
      // Esto ocurre cuando el precálculo no se ejecutó (MiniCharts no estaban listos)
      if (this._currentPlaybackTime) {
        candlesToUse = allCandles.filter(c => c.timestamp <= this._currentPlaybackTime);
      } else if (visibleCandles && visibleCandles.length > 0) {
        // Usar el timestamp de la última vela visible como playback time
        const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;
        candlesToUse = allCandles.filter(c => c.timestamp <= lastVisibleTs);

        // Log solo la primera vez
        if (!this._fallbackLoggedOnce) {
          console.log(`[${this.symbol}] 🔄 S&R: Usando visibleCandles como referencia (playbackTime no inicializado). lastVisibleTs=${new Date(lastVisibleTs).toISOString()}`);
          this._fallbackLoggedOnce = true;
        }
      }

      const needsRecalculation = !this._calculationValid ||
                                 (this.resistances.length === 0 && this.supports.length === 0) ||
                                 candlesToUse.length !== this._lastCalculatedLength;

      if (needsRecalculation && candlesToUse.length > 0) {
        console.log(`[${this.symbol}] 🔄 S&R: Recalculando (valid=${this._calculationValid}, dataLen=${candlesToUse.length}/${allCandles.length}, playbackTime=${this._currentPlaybackTime ? new Date(this._currentPlaybackTime).toISOString() : 'fallback'})`);
        this.calculateFromCandles(candlesToUse);
        this._renderLoggedOnce = false; // Reset para ver nuevos logs después de recalcular
      }
    }

    // Verificar si hay datos para renderizar
    if (this.resistances.length === 0 && this.supports.length === 0) {
      if (!this._noDataLoggedOnce) {
        console.warn(`[${this.symbol}] ⚠️ S&R: No hay niveles para renderizar (0 resistencias, 0 soportes). Precio actual: $${this.currentPrice?.toFixed(2) || 'N/A'}`);
        this._noDataLoggedOnce = true;
      }
      return;
    }
    this._noDataLoggedOnce = false;

    // DEBUG: Solo log una vez
    if (!this._renderLoggedOnce) {
      // Obtener rango de precios del contexto
      const chartMinPrice = priceContext?.minPrice;
      const chartMaxPrice = priceContext?.maxPrice;

      // Obtener rango de precios de S&R
      const srPrices = [...this.resistances, ...this.supports].map(l => l.price);
      const srMinPrice = Math.min(...srPrices);
      const srMaxPrice = Math.max(...srPrices);

      console.log(`[${this.symbol}] 🎨 S&R renderOverlay:`, {
        resistances: this.resistances.length,
        supports: this.supports.length,
        chartPriceRange: { min: chartMinPrice?.toFixed(2), max: chartMaxPrice?.toFixed(2) },
        srPriceRange: { min: srMinPrice?.toFixed(2), max: srMaxPrice?.toFixed(2) },
        pricesOverlap: srMinPrice <= chartMaxPrice && srMaxPrice >= chartMinPrice
      });
      this._renderLoggedOnce = true;
    }

    const { x, y, width, height } = bounds;

    // Extract priceToY function from priceContext
    const priceToY = priceContext ? priceContext.priceToY : null;
    if (!priceToY) {
      console.warn(`[${this.symbol}] ❌ No priceToY function in priceContext!`);
      return;
    }

    // Dibujar zonas de consolidación primero (fondo)
    if (this.showConsolidationZones) {
      this.consolidationZones.forEach(zone => {
        this.renderConsolidationZone(ctx, zone, bounds, priceToY);
      });
    }

    // Dibujar resistencias
    if (this.showResistances) {
      this.resistances.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, 'resistance');
      });
    }

    // Dibujar soportes
    if (this.showSupports) {
      this.supports.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, 'support');
      });
    }
  }

  /**
   * Renderiza una zona de consolidación
   */
  renderConsolidationZone(ctx, zone, bounds, priceToY) {
    const { x, y, width, height } = bounds;

    const minPriceY = priceToY(zone.minPrice);
    const maxPriceY = priceToY(zone.maxPrice);

    // Rectángulo sombreado
    ctx.fillStyle = "rgba(156, 39, 176, 0.05)"; // Purple muy tenue
    ctx.fillRect(x, maxPriceY, width, minPriceY - maxPriceY);

    // Borde superior e inferior
    ctx.strokeStyle = "rgba(156, 39, 176, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x, maxPriceY);
    ctx.lineTo(x + width, maxPriceY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, minPriceY);
    ctx.lineTo(x + width, minPriceY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Label de zona
    if (this.showLabels) {
      const labelY = (minPriceY + maxPriceY) / 2;
      ctx.fillStyle = "rgba(156, 39, 176, 0.7)";
      ctx.font = "10px Inter, sans-serif";
      const labelText = `Zone ${zone.rangePct.toFixed(1)}% • ${zone.numLevels} levels • Str: ${zone.avgStrength.toFixed(1)}`;
      ctx.fillText(labelText, x + 5, labelY);
    }
  }

  /**
   * Renderiza un nivel de soporte o resistencia
   */
  renderLevel(ctx, level, bounds, priceToY, type) {
    const { x, y, width, height } = bounds;

    const priceY = priceToY(level.price);

    // Verificar si el nivel está dentro del área visible
    if (priceY < y || priceY > y + height) {
      return;
    }

    // Color basado en tipo y estado
    let color, alpha, lineStyle, lineWidth;

    if (level.status === 'broken') {
      // 🎯 Niveles rotos: más tenues, punteados, delgados
      color = type === 'resistance' ? "#F44336" : "#4CAF50"; // Mismo color pero más tenue
      alpha = 0.25;
      lineStyle = [6, 4]; // Punteado más espaciado
      lineWidth = 1; // Siempre delgado
    } else if (level.status === 'tested') {
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.5;
      lineStyle = [2, 2]; // Punteado fino
      lineWidth = Math.max(1, Math.min(3, level.strength / 2));
    } else { // active
      // 🎯 Niveles activos: sólidos, más gruesos, más visibles
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.9;
      lineStyle = []; // Sólido
      lineWidth = Math.max(2, Math.min(4, level.strength / 2));
    }

    // Dibujar línea
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(lineStyle);

    ctx.beginPath();
    ctx.moveTo(x, priceY);
    ctx.lineTo(x + width, priceY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // Label
    if (this.showLabels) {
      const isBroken = level.status === 'broken';
      const prefix = type === 'resistance' ? 'R' : 'S';
      const suffix = isBroken ? ' (roto)' : '';
      const labelText = `${prefix} $${level.price.toFixed(2)}${isBroken ? suffix : ` • ${level.touches}x`}`;

      // Estilo diferente para rotos vs activos
      ctx.font = isBroken ? "9px Inter, sans-serif" : "bold 10px Inter, sans-serif";
      ctx.globalAlpha = isBroken ? 0.4 : 1.0;

      // Fondo para el label
      const metrics = ctx.measureText(labelText);
      const labelWidth = metrics.width + 8;
      const labelHeight = isBroken ? 14 : 16;
      const labelX = x + width - labelWidth - 5;
      const labelY = priceY - labelHeight / 2;

      ctx.fillStyle = isBroken ? "rgba(200, 200, 200, 0.7)" : "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

      ctx.fillStyle = color;
      ctx.fillText(labelText, labelX + 4, priceY + (isBroken ? 3 : 4));
      ctx.globalAlpha = 1.0;
    }
  }

  /**
   * Check for price alerts (when price approaches S/R levels)
   */
  checkPriceAlerts(currentPrice) {
    if (!window.addWatchlistAlert) return;
    if (!currentPrice) return;
    if (this.resistances.length === 0 && this.supports.length === 0) return;

    const proximityPercent = 0.3; // Alert when within 0.3% of level
    const minStrength = 5; // Only alert on strong levels

    // Check resistances
    this.resistances.forEach(resistance => {
      if (resistance.status !== 'active') return;
      if (resistance.strength < minStrength) return;

      const distancePercent = Math.abs((currentPrice - resistance.price) / resistance.price * 100);

      if (distancePercent <= proximityPercent) {
        // Check if we haven't alerted for this level recently
        const alertKey = `sr_alert_${this.symbol}_R_${resistance.price.toFixed(2)}`;
        const lastAlertTime = localStorage.getItem(alertKey);
        const now = Date.now();

        if (!lastAlertTime || now - parseInt(lastAlertTime) > 3600000) { // 1 hour cooldown
          localStorage.setItem(alertKey, now.toString());

          window.addWatchlistAlert({
            indicatorType: 'Support & Resistance',
            severity: resistance.strength >= 8 ? 'HIGH' : resistance.strength >= 6 ? 'MEDIUM' : 'LOW',
            icon: '🔴',
            title: `${this.symbol} approaching Resistance`,
            symbol: this.symbol,
            interval: this.interval,
            type: 'S/R Level',
            description: `Price $${currentPrice.toFixed(2)} is ${distancePercent.toFixed(2)}% from resistance level at $${resistance.price.toFixed(2)}\nStrength: ${resistance.strength.toFixed(1)}/10 • Touches: ${resistance.touches}x`,
            data: {
              price: currentPrice,
              levelPrice: resistance.price,
              levelType: 'resistance',
              strength: resistance.strength,
              touches: resistance.touches,
              distance: distancePercent
            }
          });
        }
      }
    });

    // Check supports
    this.supports.forEach(support => {
      if (support.status !== 'active') return;
      if (support.strength < minStrength) return;

      const distancePercent = Math.abs((currentPrice - support.price) / support.price * 100);

      if (distancePercent <= proximityPercent) {
        const alertKey = `sr_alert_${this.symbol}_S_${support.price.toFixed(2)}`;
        const lastAlertTime = localStorage.getItem(alertKey);
        const now = Date.now();

        if (!lastAlertTime || now - parseInt(lastAlertTime) > 3600000) { // 1 hour cooldown
          localStorage.setItem(alertKey, now.toString());

          window.addWatchlistAlert({
            indicatorType: 'Support & Resistance',
            severity: support.strength >= 8 ? 'HIGH' : support.strength >= 6 ? 'MEDIUM' : 'LOW',
            icon: '🟢',
            title: `${this.symbol} approaching Support`,
            symbol: this.symbol,
            interval: this.interval,
            type: 'S/R Level',
            description: `Price $${currentPrice.toFixed(2)} is ${distancePercent.toFixed(2)}% from support level at $${support.price.toFixed(2)}\nStrength: ${support.strength.toFixed(1)}/10 • Touches: ${support.touches}x`,
            data: {
              price: currentPrice,
              levelPrice: support.price,
              levelType: 'support',
              strength: support.strength,
              touches: support.touches,
              distance: distancePercent
            }
          });
        }
      }
    });
  }

  /**
   * Actualiza configuración
   */
  updateConfig(config) {
    console.log(`[${this.symbol}] S&R updateConfig called with:`, config);
    console.log(`[${this.symbol}] S&R BEFORE: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches}, clusterDistance=${this.clusterDistance}`);

    // Parámetros que afectan el cálculo de niveles
    const recalculateParams = ['leftBars', 'rightBars', 'minTouches', 'clusterDistance', 'maxLevels',
                               'volumeMethod', 'zScoreThreshold', 'zScorePeriod'];
    let needsRecalculate = false;

    if (config.volumeMethod !== undefined) this.volumeMethod = config.volumeMethod;
    if (config.zScoreThreshold !== undefined) this.zScoreThreshold = config.zScoreThreshold;
    if (config.zScorePeriod !== undefined) this.zScorePeriod = config.zScorePeriod;
    if (config.leftBars !== undefined) this.leftBars = config.leftBars;
    if (config.rightBars !== undefined) this.rightBars = config.rightBars;
    if (config.minTouches !== undefined) this.minTouches = config.minTouches;
    if (config.clusterDistance !== undefined) this.clusterDistance = config.clusterDistance;
    if (config.maxLevels !== undefined) this.maxLevels = config.maxLevels;
    if (config.showResistances !== undefined) this.showResistances = config.showResistances;
    if (config.showSupports !== undefined) this.showSupports = config.showSupports;
    if (config.showConsolidationZones !== undefined) this.showConsolidationZones = config.showConsolidationZones;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;
    if (config.days !== undefined) this.days = config.days;

    console.log(`[${this.symbol}] S&R AFTER: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches}, clusterDistance=${this.clusterDistance}`);

    // Verificar si algún parámetro de cálculo cambió
    for (const param of recalculateParams) {
      if (config[param] !== undefined) {
        needsRecalculate = true;
        break;
      }
    }

    // 🎯 FIX: Invalidar caché para forzar recálculo en el próximo renderOverlay
    if (needsRecalculate) {
      console.log(`[${this.symbol}] S&R: Config changed, invalidating cache for recalculation. _calculationValid = false`);
      this._calculationValid = false;
      this._renderLoggedOnce = false; // Reset log flag para mostrar nuevo cálculo

      // 🎯 NUEVO: Invalidar caché en memoria e IndexedDB
      this._cachedRawLevels = null;
      this._invalidateCache(); // Async, no bloqueante

      // NO limpiar los datos aquí - dejar que renderOverlay los recalcule
      // Esto evita que desaparezcan mientras esperamos el siguiente render
    }
  }

  /**
   * No renderiza en el panel de indicadores (se dibuja sobre el chart)
   */
  render(ctx, bounds, visibleCandles) {
    // Nada que renderizar aquí - se dibuja en renderOnPriceChart
  }

  getHeight() {
    return 0; // No ocupa espacio en el panel de indicadores
  }
}

export default SupportResistanceIndicator;
