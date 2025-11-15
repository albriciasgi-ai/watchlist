// src/components/indicators/IndicatorManager.js
// ✅ SOLUCIÓN COMPLETA: Fixed Ranges con instancias persistentes (no async)

import VolumeProfileIndicator from "./VolumeProfileIndicator";
import VolumeIndicator from "./VolumeIndicator";
import CVDIndicator from "./CVDIndicator";
import VolumeProfileFixedRangeIndicator from "./VolumeProfileFixedRangeIndicator";

class IndicatorManager {
  constructor(symbol, interval, days = 30) {
    this.symbol = symbol;
    this.interval = interval;
    this.days = days;
    this.indicators = [];
    this.heightScale = 1.0;
    this.fixedRangeProfiles = [];
    this.fixedRangeIndicators = []; // ✅ NUEVO: Instancias de fixed ranges
    
    console.log(`[${this.symbol}] 🔧 IndicatorManager: Inicializando con ${days} días @ ${interval}`);
  }

  async initialize() {
    this.indicators = [
      new VolumeProfileIndicator(this.symbol, this.interval, this.days),
      new VolumeIndicator(this.symbol, this.interval, this.days),
      new CVDIndicator(this.symbol, this.interval, this.days)
    ];

    // ✅ Ya NO necesitamos cargar datos del backend para Volume Delta y CVD
    // Solo cargar Volume Profile si es necesario
    await Promise.all(
      this.indicators.map(ind => {
        if (ind.name === "Volume Profile") {
          return ind.fetchData();
        }
        return Promise.resolve();
      })
    );
    
    this.loadFixedRangeProfilesFromStorage();
    this.syncFixedRangeIndicators(); // ✅ NUEVO: Sincronizar instancias
  }

  // ✅ NUEVO: Sincroniza instancias de fixed range indicators con los datos
  syncFixedRangeIndicators() {
    // Limpiar instancias anteriores
    this.fixedRangeIndicators = [];
    
    // Crear instancia para cada perfil
    this.fixedRangeProfiles.forEach(profileData => {
      const indicator = new VolumeProfileFixedRangeIndicator(
        this.symbol,
        this.interval,
        profileData.rangeId
      );
      indicator.loadFromData(profileData);
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

  renderOverlays(ctx, bounds, visibleCandles, allCandles) {
    // Renderizar indicadores normales (Volume Profile dinámico)
    this.indicators.forEach(indicator => {
      if (indicator.renderOverlay && indicator.enabled) {
        indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles);
      }
    });

    // ✅ NUEVO: Renderizar Fixed Range Profiles (SÍNCRONO)
    this.renderFixedRangeProfiles(ctx, bounds, visibleCandles, allCandles);
  }

  // ✅ NUEVO: Método SÍNCRONO para renderizar Fixed Range Profiles
  renderFixedRangeProfiles(ctx, bounds, visibleCandles, allCandles) {
    if (!this.fixedRangeIndicators || this.fixedRangeIndicators.length === 0) return;

    // Filtrar solo los del símbolo actual que estén habilitados
    const activeIndicators = this.fixedRangeIndicators.filter(
      indicator => indicator.enabled && indicator.symbol === this.symbol
    );

    // Renderizar cada uno
    activeIndicators.forEach(indicator => {
      try {
        if (indicator.renderOverlay) {
          indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles);
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
      rows: 24,
      valueAreaPercent: 70,
      histogramMaxWidth: 30,
      useGradient: true,
      baseColor: "#2196F3",
      valueAreaColor: "#FF9800",
      pocColor: "#F44336",
      vahValColor: "#9C27B0",
      rangeShadeColor: "rgba(33, 150, 243, 0.1)",
      enableClusterDetection: false,
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

  destroy() {
    console.log(`[${this.symbol}] 🧹 IndicatorManager destruido`);
    // Limpiar instancias
    this.fixedRangeIndicators = [];
  }
}

export default IndicatorManager;
