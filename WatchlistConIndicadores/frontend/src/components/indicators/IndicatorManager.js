// src/components/indicators/IndicatorManager.js
// ✅ SOLUCIÓN COMPLETA: Fixed Ranges con instancias persistentes (no async)
// ✅ SOLUCIÓN 1: hideWhenFixedRanges funcional - Oculta VolumeProfile cuando hay Fixed Ranges activos

import VolumeProfileIndicator from "./VolumeProfileIndicator";
import VolumeIndicator from "./VolumeIndicator";
import CVDIndicator from "./CVDIndicator";
import VolumeProfileFixedRangeIndicator from "./VolumeProfileFixedRangeIndicator";
import RangeDetectionIndicator from "./RangeDetectionIndicator";
import SwingBasedRangeDetector from "./SwingBasedRangeDetector";
import ATRBasedRangeDetector from "./ATRBasedRangeDetector";
import RejectionPatternIndicator from "./RejectionPatternIndicator";
import OpenInterestIndicator from "./OpenInterestIndicator";
import SupportResistanceIndicator from "./SupportResistanceIndicator";

class IndicatorManager {
  constructor(symbol, interval, days = 30) {
    this.symbol = symbol;
    this.interval = interval;
    this.days = days;
    this.indicators = [];
    this.heightScale = 1.0;
    this.fixedRangeProfiles = [];
    this.fixedRangeIndicators = []; // ✅ Instancias de fixed ranges

    // 🎯 NUEVO: Range Detection System
    this.rangeDetector = null;       // Detector de rangos (solo si está habilitado)
    this.autoRangeProfiles = [];     // Rangos auto-detectados

    console.log(`[${this.symbol}] 🔧 IndicatorManager: Inicializando con ${days} días @ ${interval}`);
  }

  async initialize() {
    this.indicators = [
      new VolumeProfileIndicator(this.symbol, this.interval, this.days),
      new VolumeIndicator(this.symbol, this.interval, this.days),
      new CVDIndicator(this.symbol, this.interval, this.days),
      new RejectionPatternIndicator(this.symbol, this.interval, this.days),
      new OpenInterestIndicator(this.symbol, this.interval, this.days),
      new SupportResistanceIndicator(this.symbol, this.interval, 90)
    ];

    // Habilitar el indicador de patrones por defecto
    const patternIndicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (patternIndicator) {
      patternIndicator.enabled = true;
      patternIndicator.setShowMode('all'); // Mostrar todos los patrones por defecto
    }

    // ✅ Ya NO necesitamos cargar datos del backend para Volume Delta y CVD
    // Solo cargar Volume Profile y Open Interest si es necesario
    await Promise.all(
      this.indicators.map(ind => {
        if (ind.name === "Volume Profile" || ind.name === "Open Interest") {
          return ind.fetchData();
        }
        return Promise.resolve();
      })
    );

    this.loadFixedRangeProfilesFromStorage();
    this.syncFixedRangeIndicators(); // ✅ Sincronizar instancias

    // 🎯 NUEVO: Cargar configuración de Range Detection
    this.loadRangeDetectionConfig();
  }

  // ✅ NUEVO: Sincroniza instancias de fixed range indicators con los datos
   syncFixedRangeIndicators() {
    // Limpiar instancias anteriores
    this.fixedRangeIndicators = [];
    
    // ✅ CORREGIDO: Filtrar solo perfiles del símbolo actual
    const profilesForThisSymbol = this.fixedRangeProfiles.filter(
      p => p.symbol === this.symbol
    );
    
    // Crear instancia para cada perfil del símbolo actual
    profilesForThisSymbol.forEach(profileData => {
      const indicator = new VolumeProfileFixedRangeIndicator(
        this.symbol,
        this.interval,
        profileData.rangeId
      );
      indicator.loadFromData(profileData);
      // 🎯 NUEVO: Restaurar rangeLabel si existe
      if (profileData.rangeLabel) {
        indicator.rangeLabel = profileData.rangeLabel;
      }
      this.fixedRangeIndicators.push(indicator);
    });
    
    console.log(`[${this.symbol}] 🔄 Sincronizadas ${this.fixedRangeIndicators.length} instancias de Fixed Ranges`);
  }


  // ✅ SIMPLIFICADO: refresh solo para Volume Profile
  async refresh() {
    const startTime = Date.now();
    console.log(`[${this.symbol}] 🔄 Refrescando Volume Profile...`);
    
    try {
      await Promise.all(
        this.indicators.map(async (indicator) => {
          if (indicator.enabled && indicator.name === "Volume Profile") {
            await indicator.fetchData();
          }
        })
      );
      
      const duration = Date.now() - startTime;
      console.log(`[${this.symbol}] ✅ IndicatorManager: Refresh completado en ${duration}ms`);
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error en refresh:`, error);
    }
  }

  toggleIndicator(name, enabled) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator) {
      indicator.setEnabled(enabled);
    }
  }

  applyConfig(name, config) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator && indicator.applyConfig) {
      indicator.applyConfig(config);
    }
  }

  setIndicatorMode(name, mode) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator && indicator.setMode) {
      indicator.setMode(mode);
    }
  }

  setFixedRange(name, start, end) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator && indicator.setFixedRange) {
      indicator.setFixedRange(start, end);
    }
  }

  getTotalHeight() {
    return this.indicators.reduce((sum, ind) => sum + ind.getHeight(), 0);
  }

  setHeightScale(scale) {
    this.heightScale = scale;
  }

  renderOverlays(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    // ✅ SOLUCIÓN 1: Verificar si hay Fixed Range Profiles activos para este símbolo
    const activeFixedRanges = this.fixedRangeIndicators.filter(
      ind => ind.enabled && ind.symbol === this.symbol
    );
    const hasActiveFixedRanges = activeFixedRanges.length > 0;

    // Renderizar indicadores normales (Volume Profile dinámico)
    this.indicators.forEach(indicator => {
      if (indicator.renderOverlay && indicator.enabled) {
        // ✅ SOLUCIÓN 1: Si es Volume Profile y debe ocultarse cuando hay Fixed Ranges activos
        if (indicator.name === "Volume Profile") {
          // Debug: mostrar estado del indicador
          if (indicator.hideWhenFixedRanges) {
            console.log(`[${this.symbol}] 🔍 Volume Profile - hideWhenFixedRanges=true, hasActiveFixedRanges=${hasActiveFixedRanges}`);
          }

          if (indicator.hideWhenFixedRanges && hasActiveFixedRanges) {
            // No renderizar el Volume Profile dinámico
            console.log(`[${this.symbol}] 👁️ Volume Profile OCULTO (hay ${activeFixedRanges.length} Fixed Ranges activos)`);
            return;
          }
        }

        // Renderizar el indicador normalmente
        indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles);
      }
    });

    // ✅ NUEVO: Renderizar Support & Resistance sobre el precio
    const srIndicator = this.indicators.find(ind => ind.name === "Support & Resistance");
    if (srIndicator && srIndicator.enabled && srIndicator.renderOnPriceChart && priceContext) {
      const priceToY = (price) => {
        return bounds.y + bounds.height - (price - priceContext.minPrice) * priceContext.yScale + priceContext.verticalOffset;
      };
      const xScale = bounds.width / visibleCandles.length;
      srIndicator.renderOnPriceChart(ctx, bounds, visibleCandles, priceToY, xScale);
    }

    // ✅ NUEVO: Renderizar Fixed Range Profiles (SÍNCRONO) con contexto de precio
    this.renderFixedRangeProfiles(ctx, bounds, visibleCandles, allCandles, priceContext);
  }

  // ✅ NUEVO: Método SÍNCRONO para renderizar Fixed Range Profiles
  renderFixedRangeProfiles(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    if (!this.fixedRangeIndicators || this.fixedRangeIndicators.length === 0) return;

    // 🎯 NUEVO: Verificar si se deben mostrar rangos de otros timeframes
    const showOtherTimeframes = this.rangeDetector?.config.showOtherTimeframes || false;

    // Filtrar rangos según símbolo, enabled, y timeframe
    const activeIndicators = this.fixedRangeIndicators.filter(indicator => {
      if (!indicator.enabled || indicator.symbol !== this.symbol) {
        return false;
      }

      // Obtener el perfil correspondiente para verificar el interval
      const profile = this.fixedRangeProfiles.find(p => p.rangeId === indicator.rangeId);

      // Si no es auto-detectado (rangos manuales), siempre mostrar
      if (!profile || !profile.isAutoDetected) {
        return true;
      }

      // Si es auto-detectado, verificar timeframe
      if (showOtherTimeframes) {
        return true; // Mostrar todos los timeframes
      } else {
        return profile.interval === this.interval; // Solo mostrar del timeframe actual
      }
    });

    // Renderizar cada uno con el contexto de precio (incluye verticalZoom)
    activeIndicators.forEach(indicator => {
      try {
        if (indicator.renderOverlay) {
          indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext);
        }
      } catch (error) {
        console.error(`[${this.symbol}] Error renderizando fixed range ${indicator.rangeId}:`, error);
      }
    });
  }

  renderIndicators(ctx, bounds, visibleCandles) {
    let currentY = bounds.y;
    
    this.indicators.forEach(indicator => {
      if (indicator.enabled && indicator.render && !indicator.renderOverlay) {
        const indicatorHeight = indicator.getHeight() * this.heightScale;
        const indicatorBounds = {
          x: bounds.x,
          y: currentY,
          width: bounds.width,
          height: indicatorHeight
        };
        
        indicator.render(ctx, indicatorBounds, visibleCandles);
        currentY += indicatorHeight;
      }
    });
  }

  // ==================== FIXED RANGE PROFILES ====================

  createFixedRangeProfile(startTimestamp, endTimestamp) {
    const rangeId = `range_${Date.now()}`;
    
    const newProfile = {
      rangeId: rangeId,
      symbol: this.symbol,
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      enabled: true,
      rows: 50,
      valueAreaPercent: 70,
      histogramMaxWidth: 20,
      useGradient: true,
      baseColor: "#2196F3",
      valueAreaColor: "#FF9800",
      pocColor: "#F44336",
      vahValColor: "#9C27B0",
      rangeShadeColor: "#CCCCCC", 
      enableClusterDetection: true,
      clusterThreshold: 1.5,
      clusterColor: "#4CAF50"
    };
    
    this.fixedRangeProfiles.push(newProfile);
    
    // ✅ NUEVO: Crear instancia inmediatamente
    const indicator = new VolumeProfileFixedRangeIndicator(
      this.symbol,
      this.interval,
      rangeId
    );
    indicator.loadFromData(newProfile);
    this.fixedRangeIndicators.push(indicator);
    
    console.log(`[${this.symbol}] 📊 Fixed Range creado: ${rangeId}`, {
      start: new Date(startTimestamp).toISOString(),
      end: new Date(endTimestamp).toISOString()
    });
    
    return rangeId;
  }

  getFixedRangeProfiles() {
    return this.fixedRangeProfiles.filter(p => p.symbol === this.symbol);
  }

  deleteFixedRangeProfile(rangeId) {
    this.fixedRangeProfiles = this.fixedRangeProfiles.filter(p => p.rangeId !== rangeId);
    
    // ✅ NUEVO: Eliminar instancia también
    this.fixedRangeIndicators = this.fixedRangeIndicators.filter(
      ind => ind.rangeId !== rangeId
    );
    
    console.log(`[${this.symbol}] 🗑️ Fixed Range eliminado: ${rangeId}`);
  }

  toggleFixedRangeProfile(rangeId, enabled) {
    // Actualizar en datos
    const profile = this.fixedRangeProfiles.find(p => p.rangeId === rangeId);
    if (profile) {
      profile.enabled = enabled;
    }
    
    // ✅ NUEVO: Actualizar en instancia
    const indicator = this.fixedRangeIndicators.find(ind => ind.rangeId === rangeId);
    if (indicator) {
      indicator.enabled = enabled;
    }
    
    console.log(`[${this.symbol}] 🔄 Fixed Range ${enabled ? 'habilitado' : 'deshabilitado'}: ${rangeId}`);
  }

  updateFixedRangeConfig(rangeId, config) {
    // Actualizar en datos
    const profile = this.fixedRangeProfiles.find(p => p.rangeId === rangeId);
    if (profile) {
      Object.assign(profile, config);
    }
    
    // ✅ NUEVO: Actualizar en instancia
    const indicator = this.fixedRangeIndicators.find(ind => ind.rangeId === rangeId);
    if (indicator) {
      indicator.loadFromData(profile);
    }
    
    console.log(`[${this.symbol}] ⚙️ Fixed Range configurado: ${rangeId}`);
  }

  saveFixedRangeProfilesToStorage() {
    try {
      localStorage.setItem('fixedRangeProfiles', JSON.stringify(this.fixedRangeProfiles));
      console.log(`[${this.symbol}] 💾 Fixed Ranges guardados en localStorage`);
    } catch (error) {
      console.error('Error saving fixed range profiles:', error);
    }
  }

  loadFixedRangeProfilesFromStorage() {
    try {
      const stored = localStorage.getItem('fixedRangeProfiles');
      if (stored) {
        this.fixedRangeProfiles = JSON.parse(stored);
        const count = this.fixedRangeProfiles.filter(p => p.symbol === this.symbol).length;
        console.log(`[${this.symbol}] 📂 ${count} Fixed Ranges cargados desde localStorage`);
      }
    } catch (error) {
      console.error('Error loading fixed range profiles:', error);
      this.fixedRangeProfiles = [];
    }
  }

  // ✅ NUEVO: Método para verificar gaps y refrescar si es necesario
  checkAndRefreshIfNeeded(candles) {
    // Este método ya no es necesario porque los indicadores calculan en tiempo real
    // Se mantiene por compatibilidad pero no hace nada
    return;
  }

  // ==================== RANGE DETECTION SYSTEM ====================

  /**
   * Habilita el detector de rangos para este símbolo
   */
  enableRangeDetection(config = {}) {
    if (!this.rangeDetector) {
      // 🎯 Usar ATRBasedRangeDetector (inspirado en LuxAlgo)
      this.rangeDetector = new ATRBasedRangeDetector(this.symbol, this.interval, this.days);
      console.log(`[${this.symbol}] 🎯 Range Detection HABILITADO (ATR-Based)`);
    }

    if (Object.keys(config).length > 0) {
      this.rangeDetector.updateConfig(config);
    }

    this.rangeDetector.setEnabled(true);
    this.saveRangeDetectionConfig();
  }

  /**
   * Deshabilita el detector de rangos
   */
  disableRangeDetection() {
    if (this.rangeDetector) {
      this.rangeDetector.setEnabled(false);
      console.log(`[${this.symbol}] 🎯 Range Detection DESHABILITADO`);
    }
    this.saveRangeDetectionConfig();
  }

  /**
   * Verifica si el detector está habilitado para este símbolo
   */
  isRangeDetectionEnabled() {
    return this.rangeDetector && this.rangeDetector.enabled;
  }

  /**
   * Actualiza la configuración del detector
   */
  updateRangeDetectionConfig(config) {
    if (this.rangeDetector) {
      this.rangeDetector.updateConfig(config);
      this.saveRangeDetectionConfig();
    }
  }

  /**
   * Establece un rango de fechas para análisis
   */
  setRangeDetectionDateFilter(startDate, endDate) {
    if (this.rangeDetector) {
      this.rangeDetector.setDateFilter(startDate, endDate);
      console.log(`[${this.symbol}] 📅 Filtro de fecha aplicado: ${new Date(startDate).toISOString()} → ${new Date(endDate).toISOString()}`);
    }
  }

  /**
   * Limpia el filtro de fechas
   */
  clearRangeDetectionDateFilter() {
    if (this.rangeDetector) {
      this.rangeDetector.clearDateFilter();
      console.log(`[${this.symbol}] 📅 Filtro de fecha eliminado`);
    }
  }

  /**
   * Analiza las velas en busca de rangos de consolidación
   * @param {Array} allCandles - Todas las velas disponibles
   */
  analyzeRanges(allCandles) {
    console.log(`[${this.symbol}] 🎯 IndicatorManager.analyzeRanges() llamado con ${allCandles?.length || 0} velas`);

    if (!this.rangeDetector) {
      console.log(`[${this.symbol}] ❌ No hay rangeDetector`);
      return [];
    }

    if (!this.rangeDetector.enabled) {
      console.log(`[${this.symbol}] ❌ rangeDetector está deshabilitado`);
      return [];
    }

    console.log(`[${this.symbol}] ✅ Llamando a rangeDetector.analyze()...`);
    const detectedRanges = this.rangeDetector.analyze(allCandles);

    // Procesar rangos confirmados y crear/actualizar Fixed Ranges automáticamente
    const confirmedRanges = this.rangeDetector.getDetectedRanges();

    // Primero crear nuevos rangos
    confirmedRanges.forEach(range => {
      this.createAutoFixedRange(range);
    });

    // También actualizar rangos existentes que se hayan extendido
    const allConfirmedRanges = this.rangeDetector.getDetectedRanges();
    allConfirmedRanges.forEach(range => {
      if (range.profileCreated) {
        // Si ya tiene profile creado, verificar si necesita actualización
        this.createAutoFixedRange(range);
      }
    });

    // 🎯 NUEVO: Crear VP de tendencia entre rangos (si está habilitado)
    this.createTrendProfilesBetweenRanges();

    return detectedRanges;
  }

  /**
   * Crea o actualiza un Fixed Range automáticamente desde un rango detectado
   */
  createAutoFixedRange(range) {
    // Verificar si ya existe un Fixed Range para este rango
    const existingProfile = this.fixedRangeProfiles.find(
      p => p.rangeId === range.id && p.isAutoDetected
    );

    if (existingProfile) {
      // 🎯 ACTUALIZAR el rango existente si se extendió
      if (existingProfile.endTimestamp !== range.endTimestamp) {
        console.log(`[${this.symbol}] 🔄 Actualizando Volume Profile del rango ${range.id}: ${new Date(existingProfile.endTimestamp).toISOString()} → ${new Date(range.endTimestamp).toISOString()}`);

        existingProfile.endTimestamp = range.endTimestamp;
        existingProfile.startTimestamp = range.startTimestamp; // Podría cambiar también

        // Buscar el indicador asociado y actualizar
        const existingIndicator = this.fixedRangeIndicators.find(
          ind => ind.rangeId === range.id
        );

        if (existingIndicator) {
          existingIndicator.loadFromData(existingProfile);
          // Forzar recarga de datos con el nuevo rango
          existingIndicator.needsRefresh = true;
        }

        // Guardar cambios
        this.saveFixedRangeProfiles();
      }
      return; // Ya existe y fue actualizado
    }

    const rangeProfile = {
      rangeId: range.id,
      symbol: this.symbol,
      interval: this.interval,       // 🎯 NUEVO: Guardar el timeframe
      startTimestamp: range.startTimestamp,
      endTimestamp: range.endTimestamp,
      enabled: true,
      isAutoDetected: true,  // 🎯 FLAG especial para rangos auto-detectados
      detectionScore: range.score,
      detectionMetrics: range.metrics,

      // Configuración visual diferenciada (morado transparente)
      rows: 50,
      valueAreaPercent: 70,
      histogramMaxWidth: 25,
      useGradient: true,
      baseColor: "#9C27B0",          // Morado para auto-detectados
      valueAreaColor: "#BA68C8",     // Morado claro
      pocColor: "#7B1FA2",           // Morado oscuro
      vahValColor: "#AB47BC",
      rangeShadeColor: "#CE93D8",    // Morado muy claro para el sombreado
      enableClusterDetection: true,  // 🎯 Activar detección de clusters
      clusterThreshold: 1.5,
      clusterColor: "#E65100"        // 🎯 Naranja ligeramente oscuro para clusters
    };

    // 🎯 NUEVO: Asignar letra alfabética automáticamente
    const autoRanges = this.getAutoDetectedRanges();
    const rangeIndex = autoRanges.length; // El índice del nuevo rango
    const rangeLabel = this.indexToAlphaLabel(rangeIndex);
    rangeProfile.rangeLabel = rangeLabel;

    this.fixedRangeProfiles.push(rangeProfile);

    // Crear instancia del indicador
    const indicator = new VolumeProfileFixedRangeIndicator(
      this.symbol,
      this.interval,
      range.id
    );
    indicator.loadFromData(rangeProfile);
    indicator.rangeLabel = rangeLabel; // Asignar la etiqueta al indicador
    this.fixedRangeIndicators.push(indicator);

    // Marcar el rango como procesado
    this.rangeDetector.markRangeAsProcessed(range.id);

    // Guardar en localStorage
    this.saveFixedRangeProfilesToStorage();

    console.log(`[${this.symbol}] ✨ AUTO Fixed Range creado [${rangeLabel}]:`, {
      id: range.id,
      label: rangeLabel,
      start: new Date(range.startTimestamp).toISOString(),
      end: new Date(range.endTimestamp).toISOString(),
      type: range.type,
      duration: range.duration
    });
  }

  /**
   * 🎯 NUEVO: Crea VP entre rangos detectados (para tendencias)
   */
  createTrendProfilesBetweenRanges() {
    if (!this.rangeDetector || !this.rangeDetector.config.createTrendProfiles) {
      console.log(`[${this.symbol}] ⏭️ createTrendProfiles desactivado o no hay detector`);
      return; // No crear si la opción está desactivada
    }

    // Obtener rangos auto-detectados ordenados por timestamp
    const autoRanges = this.getAutoDetectedRanges()
      .filter(p => !p.isTrendProfile) // Excluir los VP de tendencia ya creados
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    console.log(`[${this.symbol}] 📊 createTrendProfiles - Rangos encontrados: ${autoRanges.length}`);

    if (autoRanges.length < 2) {
      console.log(`[${this.symbol}] ⚠️ Se necesitan al menos 2 rangos para crear tendencias (encontrados: ${autoRanges.length})`);
      return; // Necesitamos al menos 2 rangos para crear gaps
    }

    // Detectar gaps entre rangos consecutivos
    for (let i = 0; i < autoRanges.length - 1; i++) {
      const currentRange = autoRanges[i];
      const nextRange = autoRanges[i + 1];

      // Gap entre el final del rango actual y el inicio del siguiente
      const gapStart = currentRange.endTimestamp;
      const gapEnd = nextRange.startTimestamp;

      console.log(`[${this.symbol}] 🔍 Gap ${i + 1}: ${new Date(gapStart).toISOString()} → ${new Date(gapEnd).toISOString()} (${(gapEnd - gapStart) / 60000} min)`);

      // Verificar si ya existe un VP de tendencia para este gap
      const gapExists = this.fixedRangeProfiles.some(p =>
        p.isTrendProfile &&
        p.startTimestamp === gapStart &&
        p.endTimestamp === gapEnd
      );

      if (gapExists) {
        console.log(`[${this.symbol}] ⏭️ Gap ya existe, saltando...`);
        continue; // Ya existe VP para este gap
      }

      // Verificar que hay un gap real (más de 1 timestamp de diferencia)
      if (gapEnd - gapStart > 60000) { // Al menos 1 minuto de diferencia
        console.log(`[${this.symbol}] ✅ Creando Trend Profile para gap de ${(gapEnd - gapStart) / 60000} min`);
        // Crear VP de tendencia con color diferenciado (azul/verde)
        const trendRangeId = `trend_${gapStart}_${gapEnd}`;

        const trendProfile = {
          rangeId: trendRangeId,
          symbol: this.symbol,
          interval: this.interval,       // 🎯 NUEVO: Guardar el timeframe
          startTimestamp: gapStart,
          endTimestamp: gapEnd,
          enabled: true,
          isAutoDetected: true,
          isTrendProfile: true, // 🎯 Marcador especial

          // Configuración visual diferenciada (azul/verde para tendencias)
          rows: 50,
          valueAreaPercent: 70,
          histogramMaxWidth: 25,
          useGradient: true,
          baseColor: "#2196F3",          // Azul para tendencias
          valueAreaColor: "#64B5F6",     // Azul claro
          pocColor: "#1565C0",           // Azul oscuro
          vahValColor: "#42A5F5",
          rangeShadeColor: "#90CAF9",    // Azul muy claro para el sombreado
          enableClusterDetection: true,
          clusterThreshold: 1.5,
          clusterColor: "#FF6F00"        // Naranja para clusters
        };

        this.fixedRangeProfiles.push(trendProfile);

        // Crear instancia del indicador
        const indicator = new VolumeProfileFixedRangeIndicator(
          this.symbol,
          this.interval,
          trendRangeId
        );
        indicator.loadFromData(trendProfile);
        this.fixedRangeIndicators.push(indicator);

        console.log(`[${this.symbol}] 📈 Trend Profile creado:`, {
          id: trendRangeId,
          start: new Date(gapStart).toISOString(),
          end: new Date(gapEnd).toISOString(),
          duration: (gapEnd - gapStart) / 60000 + ' min'
        });
      }
    }

    // Guardar en localStorage
    this.saveFixedRangeProfilesToStorage();
  }

  /**
   * Obtiene rangos auto-detectados
   */
  getAutoDetectedRanges() {
    return this.fixedRangeProfiles.filter(p =>
      p.symbol === this.symbol && p.isAutoDetected
    );
  }

  /**
   * Elimina todos los rangos auto-detectados
   */
  clearAutoDetectedRanges() {
    const autoRangeIds = this.fixedRangeProfiles
      .filter(p => p.symbol === this.symbol && p.isAutoDetected)
      .map(p => p.rangeId);

    autoRangeIds.forEach(rangeId => {
      this.deleteFixedRangeProfile(rangeId);
    });

    this.saveFixedRangeProfilesToStorage();
    console.log(`[${this.symbol}] 🗑️ ${autoRangeIds.length} rangos auto-detectados eliminados`);
  }

  /**
   * Guarda la configuración del detector en localStorage
   * 🎯 MODIFICADO: Ahora guarda por símbolo Y timeframe
   */
  saveRangeDetectionConfig() {
    try {
      const enabledSymbols = JSON.parse(
        localStorage.getItem('range_detection_enabled_symbols') || '[]'
      );

      if (this.isRangeDetectionEnabled()) {
        if (!enabledSymbols.includes(this.symbol)) {
          enabledSymbols.push(this.symbol);
        }

        // 🎯 NUEVO: Guardar configuración específica del símbolo + timeframe
        const configKey = `range_detection_config_${this.symbol}_${this.interval}`;
        localStorage.setItem(configKey, JSON.stringify({
          enabled: true,
          config: this.rangeDetector.config,
          lastUpdate: Date.now()
        }));
      } else {
        const index = enabledSymbols.indexOf(this.symbol);
        if (index > -1) {
          enabledSymbols.splice(index, 1);
        }
      }

      localStorage.setItem('range_detection_enabled_symbols', JSON.stringify(enabledSymbols));
      console.log(`[${this.symbol}@${this.interval}] 💾 Config de Range Detection guardada`);
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error guardando config:`, error);
    }
  }

  /**
   * Carga la configuración del detector desde localStorage
   * 🎯 MODIFICADO: Ahora carga por símbolo Y timeframe
   */
  loadRangeDetectionConfig() {
    try {
      const enabledSymbols = JSON.parse(
        localStorage.getItem('range_detection_enabled_symbols') || '[]'
      );

      if (enabledSymbols.includes(this.symbol)) {
        // 🎯 NUEVO: Cargar configuración específica del símbolo + timeframe
        const configKey = `range_detection_config_${this.symbol}_${this.interval}`;
        const stored = localStorage.getItem(configKey);

        if (stored) {
          const { config } = JSON.parse(stored);
          this.enableRangeDetection(config);
          console.log(`[${this.symbol}] 📂 Config de Range Detection cargada`);
        } else {
          this.enableRangeDetection();
        }
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error cargando config:`, error);
    }
  }

  destroy() {
    console.log(`[${this.symbol}] 🧹 IndicatorManager destruido`);
    // Limpiar instancias
    this.fixedRangeIndicators = [];
    this.rangeDetector = null;
  }

  /**
   * 🎯 NUEVO: Convierte índice numérico a etiqueta alfabética
   * 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, 27 -> AB, etc.
   */
  indexToAlphaLabel(index) {
    let label = '';
    let num = index;

    do {
      label = String.fromCharCode(65 + (num % 26)) + label;
      num = Math.floor(num / 26) - 1;
    } while (num >= 0);

    return label;
  }

  // ==================== REJECTION PATTERN SYSTEM ====================

  /**
   * Actualiza la configuración del indicador de patrones de rechazo
   */
  updateRejectionPatternConfig(config) {
    const indicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (indicator) {
      indicator.updateConfig(config);
      console.log(`[${this.symbol}] 🎯 Rejection Pattern config updated`);
    }
  }

  /**
   * Fuerza la detección de patrones (útil después de cambiar configuración)
   */
  async detectRejectionPatterns() {
    const indicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (indicator && indicator.enabled) {
      await indicator.fetchData();
      console.log(`[${this.symbol}] 🔍 Rejection patterns detected: ${indicator.getPatternCount()}`);
      return indicator.patterns;
    }
    return [];
  }

  /**
   * Obtiene el indicador de patrones de rechazo
   */
  getRejectionPatternIndicator() {
    return this.indicators.find(ind => ind.name === "Rejection Patterns");
  }

  /**
   * Obtiene el indicador de Volume Profile dinámico
   */
  getVolumeProfileIndicator() {
    return this.indicators.find(ind => ind.name === "Volume Profile");
  }

  /**
   * Verifica si el Volume Profile dinámico está activo y tiene datos calculados
   */
  hasDynamicVolumeProfile() {
    const vpIndicator = this.getVolumeProfileIndicator();
    return vpIndicator && vpIndicator.enabled && vpIndicator.profile !== null;
  }

  /**
   * Obtiene los datos del Volume Profile dinámico (POC, VAH, VAL)
   */
  getDynamicVolumeProfileData() {
    const vpIndicator = this.getVolumeProfileIndicator();
    if (!vpIndicator || !vpIndicator.profile) {
      return null;
    }

    const profile = vpIndicator.profile;
    return {
      poc: profile.poc?.price || null,
      vah: profile.valueArea?.vahPrice || null,
      val: profile.valueArea?.valPrice || null,
      minPrice: profile.minPrice,
      maxPrice: profile.maxPrice,
      startTimestamp: profile.startTimestamp,
      endTimestamp: profile.endTimestamp
    };
  }
}

export default IndicatorManager;
