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
import SupportResistanceIndicator from "./SupportResistanceIndicator";
import OpenInterestIndicator from "./OpenInterestIndicator";
import VWAPIndicator from "./VWAPIndicator";
import FibonacciLevelCalculator from "./FibonacciLevelCalculator";
import LevelSourceManager from "./LevelSourceManager";
import ContinuationPatternIndicator from "./ContinuationPatternIndicator";
import DoubleTopBottomIndicator from "./DoubleTopBottomIndicator"; // Updated: minConfidence 20%
import SwingDetectorIndicator from "./SwingDetectorIndicator";
import SupportResistance2Indicator from "./SupportResistance2Indicator";
import ZoneVisualizerIndicator from "./ZoneVisualizerIndicator";
import IndicatorPreloader from "../../utils/IndicatorPreloader";
import { API_BASE_URL } from "../../config";
import Logger from '../../utils/Logger.js';

// Logger instance
const log = new Logger('Manager', { level: 'info' });

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

    // 📊 NUEVO: Support & Resistance Indicator
    this.supportResistanceIndicator = null; // Indicador de S/R (solo si está habilitado)

    // ✅ NUEVO: Cache para optimizar getAllReferenceLevels()
    this._referenceLevelsCache = null;
    this._referenceLevelsCacheKey = null;
    this._lastCacheTime = 0;

    // 📊 NUEVO: Open Interest Indicator
    this.openInterestIndicator = null; // Indicador de Open Interest (solo si está habilitado)

    // 🎯 NUEVO: Level Source Manager (for continuation patterns)
    this.levelSourceManager = null; // Gestión centralizada de niveles de múltiples fuentes

    // ✅ NUEVO: Referencia a las velas históricas (necesario para fetchData en DBT)
    this.allCandles = null;

    // 🎯 NUEVO: Zone Visualizer (para trading zones)
    this.zoneVisualizerIndicator = null;

    // Realtime zone polling
    this._realtimeZoneTimerId = null;
    this._realtimeZoneEnabled = false;
    this._lastRealtimeZoneFingerprint = ''; // Para detectar cambios
    this._zoneMetricsTimerId = null;

    log.debug(`[${this.symbol}] 🔧 IndicatorManager: Inicializando con ${days} días @ ${interval}`);
  }

  async initialize(indicatorStates = {}) {
    // 🚀 LAZY LOADING: Solo crear indicadores HABILITADOS para optimizar rendimiento
    this.indicators = [];

    // Volume Profile - solo si habilitado
    if (indicatorStates['Volume Profile'] === true) {
      this.indicators.push(new VolumeProfileIndicator(this.symbol, this.interval, this.days));
    }

    // Volume Delta - solo si habilitado
    if (indicatorStates['Volume Delta'] === true) {
      this.indicators.push(new VolumeIndicator(this.symbol, this.interval, this.days));
    }

    // CVD - solo si habilitado
    if (indicatorStates['CVD'] === true) {
      this.indicators.push(new CVDIndicator(this.symbol, this.interval, this.days));
    }

    // OpenInterest - solo si habilitado
    if (indicatorStates['Open Interest'] === true) {
      this.openInterestIndicator = new OpenInterestIndicator(this.symbol, this.interval, this.days);
      this.indicators.push(this.openInterestIndicator);
    }

    // Rejection Patterns - solo si habilitado
    if (indicatorStates['Rejection Patterns'] === true) {
      log.debug(`[${this.symbol}] Creando Rejection Patterns`);
      this.indicators.push(new RejectionPatternIndicator(this.symbol, this.interval, this.days));
    }

    // Double Top/Bottom - solo si habilitado
    if (indicatorStates['Double Top/Bottom'] === true) {
      log.debug(`[${this.symbol}] Creando Double Top/Bottom`);
      this.indicators.push(new DoubleTopBottomIndicator(this.symbol, this.interval, this.days));
    }

    // Support & Resistance - solo si habilitado
    if (indicatorStates['Support & Resistance'] === true) {
      log.debug(`[${this.symbol}] Creando Support & Resistance`);
      this.supportResistanceIndicator = new SupportResistanceIndicator(this.symbol, this.interval, this.days);
      this.supportResistanceIndicator.enabled = true;
      this.indicators.push(this.supportResistanceIndicator);
    }

    // VWAP - solo si habilitado
    if (indicatorStates['VWAP'] === true) {
      log.debug(`[${this.symbol}] Creando VWAP`);
      this.indicators.push(new VWAPIndicator(this.symbol, this.interval, this.days));
    }

    // Fibonacci - solo si habilitado
    if (indicatorStates['Fibonacci'] === true) {
      log.debug(`[${this.symbol}] Creando Fibonacci`);
      this.indicators.push(new FibonacciLevelCalculator(this.symbol, this.interval, this.days));
    }

    // Continuation Patterns - solo si habilitado
    if (indicatorStates['Continuation Patterns'] === true) {
      log.debug(`[${this.symbol}] Creando Continuation Patterns`);
      this.indicators.push(new ContinuationPatternIndicator(this.symbol, this.interval, this.days));
    }

    // Swing Detector - solo si habilitado
    if (indicatorStates['Swing Detector'] === true) {
      console.log(`[${this.symbol}] [SWING] initialize(): Creando SwingDetectorIndicator`);
      this.indicators.push(new SwingDetectorIndicator(this.symbol, this.interval, this.days));
    } else {
      console.log(`[${this.symbol}] [SWING] initialize(): NO creado (indicatorStates['Swing Detector']=${indicatorStates['Swing Detector']})`);
    }

    // S&R v2 (Swing-based) - solo si habilitado
    if (indicatorStates['S&R v2'] === true) {
      log.debug(`[${this.symbol}] Creando S&R v2 (Swing-based)`);
      this.indicators.push(new SupportResistance2Indicator(this.symbol, this.interval, this.days));
    }

    // Zone Visualizer - siempre disponible (las zonas se cargan bajo demanda)
    this.zoneVisualizerIndicator = new ZoneVisualizerIndicator(this.symbol, this.interval, this.days);
    this.zoneVisualizerIndicator.enabled = true;
    this.indicators.push(this.zoneVisualizerIndicator);
    log.debug(`[${this.symbol}] Zone Visualizer creado (siempre disponible)`);

    // Asignar referencia al manager a todos los indicadores
    this.indicators.forEach(indicator => {
      indicator.indicatorManager = this;
    });

    // Inicializar Level Source Manager
    this.levelSourceManager = new LevelSourceManager(this);

    // Habilitar el indicador de patrones si existe
    const patternIndicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (patternIndicator) {
      patternIndicator.enabled = true;
      patternIndicator.setShowMode('validated');
    }

    log.debug(`[${this.symbol}] 🚀 Inicializados ${this.indicators.length} indicadores (lazy loading)`);

    this.loadFixedRangeProfilesFromStorage();
    this.syncFixedRangeIndicators();
    this.loadRangeDetectionConfig();
  }

  /**
   * 🚀 LAZY: Crea un indicador bajo demanda cuando se habilita
   */
  _createIndicator(name) {
    switch (name) {
      case 'Volume Profile':
        return new VolumeProfileIndicator(this.symbol, this.interval, this.days);
      case 'Volume Delta':
        return new VolumeIndicator(this.symbol, this.interval, this.days);
      case 'CVD':
        return new CVDIndicator(this.symbol, this.interval, this.days);
      case 'Open Interest':
        return new OpenInterestIndicator(this.symbol, this.interval, this.days);
      case 'Rejection Patterns':
        return new RejectionPatternIndicator(this.symbol, this.interval, this.days);
      case 'Double Top/Bottom':
        return new DoubleTopBottomIndicator(this.symbol, this.interval, this.days);
      case 'Support & Resistance':
        const sr = new SupportResistanceIndicator(this.symbol, this.interval, this.days);
        this.supportResistanceIndicator = sr;
        return sr;
      case 'VWAP':
        return new VWAPIndicator(this.symbol, this.interval, this.days);
      case 'Fibonacci':
        return new FibonacciLevelCalculator(this.symbol, this.interval, this.days);
      case 'Continuation Patterns':
        return new ContinuationPatternIndicator(this.symbol, this.interval, this.days);
      case 'Swing Detector':
        return new SwingDetectorIndicator(this.symbol, this.interval, this.days);
      case 'S&R v2':
        return new SupportResistance2Indicator(this.symbol, this.interval, this.days);
      default:
        log.warn(`[${this.symbol}] Unknown indicator: ${name}`);
        return null;
    }
  }

  // ✅ NUEVO: Método para cargar datos precargados
  loadPreloadedData() {
    log.debug(`[${this.symbol}] 📂 Cargando datos precargados...`);

    this.indicators.forEach(indicator => {
      const preloadableIndicators = [
        'Volume Profile',
        'Open Interest',
        'Support & Resistance'
      ];

      if (preloadableIndicators.includes(indicator.name)) {
        const data = IndicatorPreloader.getData(
          this.symbol,
          indicator.name,
          this.interval,
          this.days
        );

        if (data) {
          // Usar método setPreloadedData() del indicador (lo implementaremos)
          if (indicator.setPreloadedData) {
            indicator.setPreloadedData(data);
            log.debug(`[${this.symbol}] ✅ ${indicator.name} cargado desde precarga`);
          }
        } else {
          log.warn(`[${this.symbol}] ⚠️ ${indicator.name} no tiene datos precargados`);
        }
      }
    });
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
    
    log.debug(`[${this.symbol}] 🔄 Sincronizadas ${this.fixedRangeIndicators.length} instancias de Fixed Ranges`);
  }


  // ✅ OPTIMIZADO: refresh SECUENCIAL con prioridades para evitar saturar la red
  // Prioridad 1 (criticos): VWAP - Se cargan primero
  // Prioridad 2 (secundarios): Swing Detector, S&R v2 - Se cargan despues
  // Prioridad 3 (opcionales): Volume Profile, DTB, Rejection - Se cargan al final
  async refresh() {
    const startTime = Date.now();
    log.debug(`[${this.symbol}] Refrescando indicadores SECUENCIAL (priorizado)...`);

    try {
      // Separar indicadores por prioridad
      const priority1 = []; // Criticos - cargan primero
      const priority2 = []; // Secundarios
      const priority3 = []; // Opcionales

      this.indicators.forEach((indicator) => {
        if (!indicator.enabled) {
          if (indicator.name === 'Swing Detector') {
            console.warn(`[${this.symbol}] [SWING] refresh(): SKIP - indicator.enabled=false`);
          }
          return;
        }

        // VWAP - Prioridad 1
        if (indicator.name === "VWAP") {
          let needsRefetch = false;

          if (indicator.interval !== this.interval) {
            if (indicator.setInterval) {
              indicator.setInterval(this.interval);
            } else {
              indicator.interval = this.interval;
              indicator.lastFetchTime = 0;
            }
            needsRefetch = true;
          }

          if (indicator.days !== this.days) {
            if (indicator.setDays) {
              indicator.setDays(this.days);
            } else {
              indicator.days = this.days;
              indicator.lastFetchTime = 0;
            }
            needsRefetch = true;
          }

          if (needsRefetch && indicator.fetchData) {
            priority1.push({ indicator, name: "VWAP" });
          }
        }

        // Swing Detector - Prioridad 2
        if (indicator.name === "Swing Detector" && indicator.fetchData) {
          console.log(`[${this.symbol}] [SWING] refresh(): agregado a priority2 (enabled=${indicator.enabled})`);
          priority2.push({ indicator, name: "Swing Detector" });
        }

        // S&R v2 - Prioridad 2
        if (indicator.name === "S&R v2" && indicator.fetchData) {
          priority2.push({ indicator, name: "S&R v2" });
        }

        // Volume Profile, Open Interest, Support & Resistance - Prioridad 3
        if (indicator.name === "Volume Profile" || indicator.name === "Open Interest" || indicator.name === "Support & Resistance") {
          if (indicator.days !== this.days) {
            indicator.days = this.days;
          }
          if (indicator.fetchData) {
            priority3.push({ indicator, name: indicator.name });
          }
        }

        // Double Top/Bottom - Prioridad 3
        if (indicator.name === "Double Top/Bottom" && indicator.enabled && indicator.fetchData) {
          priority3.push({ indicator, name: "Double Top/Bottom", candles: this.allCandles });
        }

        // Rejection Patterns - Prioridad 3
        if (indicator.name === "Rejection Patterns" && indicator.enabled && indicator.fetchData) {
          priority3.push({ indicator, name: "Rejection Patterns", candles: this.allCandles });
        }
      });

      // Funcion para ejecutar un batch de indicadores
      const executeBatch = async (batch, batchName) => {
        if (batch.length === 0) return;

        log.debug(`[${this.symbol}] Ejecutando ${batchName}: ${batch.map(b => b.name).join(', ')}`);

        const promises = batch.map(({ indicator, name, candles }) => {
          if (candles) {
            return indicator.fetchData(candles).catch(err => {
              log.error(`[${this.symbol}] Error fetching ${name}:`, err);
            });
          }
          return indicator.fetchData().catch(err => {
            log.error(`[${this.symbol}] Error fetching ${name}:`, err);
          });
        });

        await Promise.all(promises);
      };

      // Ejecutar en orden de prioridad con pequeno delay entre batches
      await executeBatch(priority1, "Prioridad 1 (criticos)");

      if (priority2.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        await executeBatch(priority2, "Prioridad 2 (secundarios)");
      }

      if (priority3.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        await executeBatch(priority3, "Prioridad 3 (opcionales)");
      }

      // Zone Detector metrics - cargar en background despues de los indicadores
      this._fetchZoneMetrics();

      const duration = Date.now() - startTime;
      const totalIndicators = priority1.length + priority2.length + priority3.length;
      log.debug(`[${this.symbol}] Refresh completado en ${duration}ms (${totalIndicators} indicadores en 3 batches)`);
    } catch (error) {
      log.error(`[${this.symbol}] Error en refresh:`, error);
    }
  }

  // ✅ NUEVO: Actualizar intervalo de todos los indicadores
  updateInterval(newInterval) {
    if (this.interval !== newInterval) {
      log.debug(`[${this.symbol}] 🔄 Actualizando interval del manager: ${this.interval} → ${newInterval}`);
      this.interval = newInterval;
    }
  }

  // ✅ NUEVO: Actualizar días de todos los indicadores
  updateDays(newDays) {
    if (this.days !== newDays) {
      log.debug(`[${this.symbol}] Actualizando days del manager: ${this.days} -> ${newDays}`);
      this.days = newDays;

      // Sync SwingDetector days with backend
      const swingIndicator = this.getSwingDetectorIndicator();
      if (swingIndicator && swingIndicator.enabled && swingIndicator.syncDaysWithBackend) {
        swingIndicator.syncDaysWithBackend(newDays);
      }
    }
  }

  toggleIndicator(name, enabled) {
    let indicator = this.indicators.find(ind => ind.name === name);

    if (name === 'Swing Detector') {
      console.log(`[${this.symbol}] [SWING] toggleIndicator(${name}, ${enabled}): found=${!!indicator}, totalIndicators=${this.indicators.length}`);
    }

    // 🚀 LAZY: Si se habilita y no existe, crearlo bajo demanda
    if (enabled && !indicator) {
      log.debug(`[${this.symbol}] Creando ${name} bajo demanda (lazy)`);
      indicator = this._createIndicator(name);
      if (indicator) {
        indicator.indicatorManager = this;
        this.indicators.push(indicator);
        if (name === 'Swing Detector') {
          console.log(`[${this.symbol}] [SWING] Creado bajo demanda, enabled=${indicator.enabled}`);
        }
      }
    }

    if (indicator) {
      indicator.setEnabled(enabled);

      if (name === 'Swing Detector') {
        console.log(`[${this.symbol}] [SWING] setEnabled(${enabled}) aplicado, indicator.enabled=${indicator.enabled}`);
      }

      // Cargar datos si se habilita
      if (enabled && indicator.fetchData) {
        log.debug(`[${this.symbol}] Cargando datos para ${name}...`);

        indicator.fetchData().then(() => {
          log.debug(`[${this.symbol}] Datos de ${name} cargados`);
          if (name === 'Swing Detector') {
            console.log(`[${this.symbol}] [SWING] fetchData completado via toggle, signals=${indicator.signals?.length}, requestRedraw=${!!this.requestRedraw}`);
          }
          if (this.requestRedraw) {
            this.requestRedraw();
          }
        }).catch(err => {
          log.error(`[${this.symbol}] Error cargando ${name}:`, err);
        });
      }
    } else if (name === 'Swing Detector') {
      console.warn(`[${this.symbol}] [SWING] toggleIndicator: indicator es NULL despues de intentar crear`);
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

  renderOverlays(ctx, bounds, visibleCandles, allCandles, priceContext = null, manualLevels = []) {
    // Log de diagnostico una vez por segundo
    if (!this._lastOverlayLog || Date.now() - this._lastOverlayLog > 2000) {
      this._lastOverlayLog = Date.now();
      const overlayIndicators = this.indicators.filter(i => i.renderOverlay);
      const enabledOverlays = overlayIndicators.filter(i => i.enabled);
      const swingInd = this.indicators.find(i => i.name === 'Swing Detector');
      console.log(`[${this.symbol}] [RENDER] renderOverlays: ${this.indicators.length} total, ${overlayIndicators.length} con renderOverlay, ${enabledOverlays.length} enabled. Swing=${swingInd ? `found(enabled=${swingInd.enabled})` : 'NOT FOUND'}`);
    }

    // Verificar si hay Fixed Range Profiles activos para este simbolo
    const activeFixedRanges = this.fixedRangeIndicators.filter(
      ind => ind.enabled && ind.symbol === this.symbol
    );
    const hasActiveFixedRanges = activeFixedRanges.length > 0;

    // Renderizar indicadores normales (Volume Profile dinamico)
    this.indicators.forEach(indicator => {
      if (indicator.renderOverlay && indicator.enabled) {
        // ✅ SOLUCIÓN 1: Si es Volume Profile y debe ocultarse cuando hay Fixed Ranges activos
        if (indicator.name === "Volume Profile") {
          // Debug: mostrar estado del indicador
          if (indicator.hideWhenFixedRanges) {
            log.trace(`[ Volume Profile - hideWhenFixedRanges=true, hasActiveFixedRanges=${hasActiveFixedRanges}`);
          }

          if (indicator.hideWhenFixedRanges && hasActiveFixedRanges) {
            // No renderizar el Volume Profile dinámico
            log.debug(`[${this.symbol}] 👁️ Volume Profile OCULTO (hay ${activeFixedRanges.length} Fixed Ranges activos)`);
            return;
          }
        }

        // Renderizar el indicador normalmente
        // Para RejectionPatternIndicator, pasar el indicatorManager y manualLevels
        if (indicator.name === "Rejection Patterns") {
          indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext, this, manualLevels);
        } else {
          indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext);
        }
      }
    });

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
        log.error(`[${this.symbol}] Error renderizando fixed range ${indicator.rangeId}:`, error);
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
    
    log.debug(`[${this.symbol}] 📊 Fixed Range creado: ${rangeId}`, {
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

    log.debug(`[${this.symbol}] 🗑️ Fixed Range eliminado: ${rangeId}`);
  }

  // ✅ NUEVO: Método para borrar todos los Fixed Range Profiles de este símbolo
  deleteAllFixedRangeProfiles() {
    const profilesToDelete = this.fixedRangeProfiles.filter(p => p.symbol === this.symbol);
    const count = profilesToDelete.length;

    // Eliminar todos los perfiles del símbolo actual
    this.fixedRangeProfiles = this.fixedRangeProfiles.filter(p => p.symbol !== this.symbol);

    // Eliminar todas las instancias del símbolo actual
    this.fixedRangeIndicators = this.fixedRangeIndicators.filter(
      ind => ind.symbol !== this.symbol
    );

    // Guardar en localStorage
    this.saveFixedRangeProfilesToStorage();

    log.debug(`[${this.symbol}] 🗑️ TODOS los Fixed Ranges eliminados: ${count} perfiles`);
    return count;
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
    
    log.debug(`[${this.symbol}] 🔄 Fixed Range ${enabled ? 'habilitado' : 'deshabilitado'}: ${rangeId}`);
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
    
    log.debug(`[${this.symbol}] ⚙️ Fixed Range configurado: ${rangeId}`);
  }

  saveFixedRangeProfilesToStorage() {
    try {
      localStorage.setItem('fixedRangeProfiles', JSON.stringify(this.fixedRangeProfiles));
      log.debug(`[${this.symbol}] 💾 Fixed Ranges guardados en localStorage`);
    } catch (error) {
      log.error('Error saving fixed range profiles:', error);
    }
  }

  loadFixedRangeProfilesFromStorage() {
    try {
      const stored = localStorage.getItem('fixedRangeProfiles');
      if (stored) {
        this.fixedRangeProfiles = JSON.parse(stored);
        const count = this.fixedRangeProfiles.filter(p => p.symbol === this.symbol).length;
        log.debug(`[${this.symbol}] 📂 ${count} Fixed Ranges cargados desde localStorage`);
      }
    } catch (error) {
      log.error('Error loading fixed range profiles:', error);
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
      log.debug(`[${this.symbol}] 🎯 Range Detection HABILITADO (ATR-Based)`);
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
      log.debug(`[${this.symbol}] 🎯 Range Detection DESHABILITADO`);
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
      log.debug(`[${this.symbol}] 📅 Filtro de fecha aplicado: ${new Date(startDate).toISOString()} → ${new Date(endDate).toISOString()}`);
    }
  }

  /**
   * Limpia el filtro de fechas
   */
  clearRangeDetectionDateFilter() {
    if (this.rangeDetector) {
      this.rangeDetector.clearDateFilter();
      log.debug(`[${this.symbol}] 📅 Filtro de fecha eliminado`);
    }
  }

  /**
   * Analiza las velas en busca de rangos de consolidación
   * @param {Array} allCandles - Todas las velas disponibles
   */
  analyzeRanges(allCandles) {
    log.debug(`[${this.symbol}] 🎯 IndicatorManager.analyzeRanges() llamado con ${allCandles?.length || 0} velas`);

    if (!this.rangeDetector) {
      log.debug(`[${this.symbol}] ❌ No hay rangeDetector`);
      return [];
    }

    if (!this.rangeDetector.enabled) {
      log.debug(`[${this.symbol}] ❌ rangeDetector está deshabilitado`);
      return [];
    }

    // ✅ NUEVO: Filtrar velas según el rango de días seleccionado
    const cutoffTime = Date.now() - (this.days * 24 * 60 * 60 * 1000);
    const filteredCandles = allCandles.filter(c => c.timestamp >= cutoffTime);

    log.debug(`[${this.symbol}] ✅ Filtrando velas: ${allCandles.length} total → ${filteredCandles.length} en últimos ${this.days} días`);
    log.debug(`[${this.symbol}] ✅ Llamando a rangeDetector.analyze()...`);
    const detectedRanges = this.rangeDetector.analyze(filteredCandles);

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
        log.debug(`[${this.symbol}] 🔄 Actualizando Volume Profile del rango ${range.id}: ${new Date(existingProfile.endTimestamp).toISOString()} → ${new Date(range.endTimestamp).toISOString()}`);

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

    log.debug(`[${this.symbol}] ✨ AUTO Fixed Range creado [${rangeLabel}]:`, {
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
      log.debug(`[${this.symbol}] ⏭️ createTrendProfiles desactivado o no hay detector`);
      return; // No crear si la opción está desactivada
    }

    // Obtener rangos auto-detectados ordenados por timestamp
    const autoRanges = this.getAutoDetectedRanges()
      .filter(p => !p.isTrendProfile) // Excluir los VP de tendencia ya creados
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    log.debug(`[${this.symbol}] 📊 createTrendProfiles - Rangos encontrados: ${autoRanges.length}`);

    if (autoRanges.length < 2) {
      log.debug(`[${this.symbol}] ⚠️ Se necesitan al menos 2 rangos para crear tendencias (encontrados: ${autoRanges.length})`);
      return; // Necesitamos al menos 2 rangos para crear gaps
    }

    // Detectar gaps entre rangos consecutivos
    for (let i = 0; i < autoRanges.length - 1; i++) {
      const currentRange = autoRanges[i];
      const nextRange = autoRanges[i + 1];

      // Gap entre el final del rango actual y el inicio del siguiente
      const gapStart = currentRange.endTimestamp;
      const gapEnd = nextRange.startTimestamp;

      log.trace(`[ Gap ${i + 1}: ${new Date(gapStart).toISOString()} → ${new Date(gapEnd).toISOString()} (${(gapEnd - gapStart) / 60000} min)`);

      // Verificar si ya existe un VP de tendencia para este gap
      const gapExists = this.fixedRangeProfiles.some(p =>
        p.isTrendProfile &&
        p.startTimestamp === gapStart &&
        p.endTimestamp === gapEnd
      );

      if (gapExists) {
        log.debug(`[${this.symbol}] ⏭️ Gap ya existe, saltando...`);
        continue; // Ya existe VP para este gap
      }

      // Verificar que hay un gap real (más de 1 timestamp de diferencia)
      if (gapEnd - gapStart > 60000) { // Al menos 1 minuto de diferencia
        log.debug(`[${this.symbol}] ✅ Creando Trend Profile para gap de ${(gapEnd - gapStart) / 60000} min`);
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

        log.debug(`[${this.symbol}] 📈 Trend Profile creado:`, {
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

    // También limpiar el detector de rangos si existe
    if (this.rangeDetector) {
      this.rangeDetector.clearAllRanges();
    }

    this.saveFixedRangeProfilesToStorage();
    log.debug(`[${this.symbol}] 🗑️ ${autoRangeIds.length} rangos auto-detectados eliminados`);
  }

  // ==================== ZONE DETECTOR VOLUME PROFILES ====================

  /**
   * Crea Volume Profile Fixed Range para zonas del Zone Detector.
   * Limpia VP anteriores del zone detector antes de crear nuevos.
   * @param {Array} zones - Zonas detectadas con start_timestamp, end_timestamp
   */
  createZoneDetectorFixedRanges(zones) {
    // 1. Limpiar VP anteriores del zone detector
    this.clearZoneDetectorFixedRanges();

    if (!zones || zones.length === 0) {
      log.debug(`[${this.symbol}] No hay zonas para crear VP`);
      return 0;
    }

    let created = 0;
    zones.forEach((zone, idx) => {
      const startTs = zone.start_timestamp;
      const endTs = zone.end_timestamp;

      if (!startTs || !endTs) return;

      const rangeId = `zd_vp_${startTs}_${idx}`;

      const rangeProfile = {
        rangeId: rangeId,
        symbol: this.symbol,
        interval: this.interval,
        startTimestamp: startTs,
        endTimestamp: endTs,
        enabled: true,
        isZoneDetector: true,  // Flag para identificar VP del zone detector
        rows: 50,
        valueAreaPercent: 70,
        histogramMaxWidth: 25,
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

      // Asignar etiqueta alfabetica
      const rangeLabel = this.indexToAlphaLabel(idx);
      rangeProfile.rangeLabel = rangeLabel;

      this.fixedRangeProfiles.push(rangeProfile);

      // Crear instancia del indicador
      const indicator = new VolumeProfileFixedRangeIndicator(
        this.symbol,
        this.interval,
        rangeId
      );
      indicator.loadFromData(rangeProfile);
      indicator.rangeLabel = rangeLabel;
      this.fixedRangeIndicators.push(indicator);

      created++;
    });

    this.saveFixedRangeProfilesToStorage();
    log.debug(`[${this.symbol}] Zone Detector VP: ${created} Volume Profiles creados`);
    return created;
  }

  /**
   * Elimina todos los Volume Profile Fixed Range creados por el Zone Detector.
   * No afecta VP manuales ni los del Range Detection.
   */
  clearZoneDetectorFixedRanges() {
    const zdRangeIds = this.fixedRangeProfiles
      .filter(p => p.symbol === this.symbol && p.isZoneDetector)
      .map(p => p.rangeId);

    if (zdRangeIds.length === 0) return 0;

    zdRangeIds.forEach(rangeId => {
      this.deleteFixedRangeProfile(rangeId);
    });

    this.saveFixedRangeProfilesToStorage();
    log.debug(`[${this.symbol}] Zone Detector VP: ${zdRangeIds.length} Volume Profiles eliminados`);
    return zdRangeIds.length;
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
      log.debug(`[${this.symbol}@${this.interval}] 💾 Config de Range Detection guardada`);
    } catch (error) {
      log.error(`[${this.symbol}] ❌ Error guardando config:`, error);
    }
  }

  /**
   * Carga la configuración del detector desde localStorage
   * 🎯 MODIFICADO: Ahora carga por símbolo Y timeframe
   * ✅ FIX: Deshabilitado por default - el usuario debe habilitarlo manualmente
   */
  loadRangeDetectionConfig() {
    // ✅ FIX: Range Detector deshabilitado por default
    // El usuario debe habilitarlo manualmente desde el settings modal
    log.debug(`[${this.symbol}] ⚪ Range Detection deshabilitado por default`);

    /* ANTERIOR: Cargaba automáticamente desde localStorage
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
          log.debug(`[${this.symbol}] 📂 Config de Range Detection cargada`);
        } else {
          this.enableRangeDetection();
        }
      }
    } catch (error) {
      log.error(`[${this.symbol}] ❌ Error cargando config:`, error);
    }
    */
  }

  destroy() {
    log.debug(`[${this.symbol}] 🧹 IndicatorManager destruido`);

    // Detener polling de zonas realtime y metricas
    this.stopRealtimeZonePolling();
    this._stopZoneMetricsPolling();

    // Destroy all indicators (stops pending fetches)
    this.indicators.forEach(indicator => {
      if (indicator.destroy) {
        indicator.destroy();
      }
    });

    // Limpiar instancias
    this.indicators = [];
    this.fixedRangeIndicators = [];
    this.rangeDetector = null;
  }

  /**
   * 🚀 OPTIMIZACIÓN: Descarga datos de indicadores para liberar RAM
   * Los datos permanecen en IndicatorCache (IndexedDB) para restaurar después
   * Llamado cuando el chart sale del viewport
   */
  unloadData() {
    log.debug(`[${this.symbol}] 💤 Descargando datos de indicadores (RAM optimization)`);

    this.indicators.forEach(indicator => {
      // Limpiar arrays de datos grandes
      if (indicator.vwapData) {
        indicator.vwapData = [];
      }
      if (indicator.dataMap) {
        indicator.dataMap.clear();
      }
      if (indicator.signals) {
        indicator.signals = [];
      }
      if (indicator.resistances) {
        indicator.resistances = [];
      }
      if (indicator.supports) {
        indicator.supports = [];
      }
      if (indicator.consolidationZones) {
        indicator.consolidationZones = [];
      }
      // Volume Delta / CVD
      if (indicator.volumeDeltaData) {
        indicator.volumeDeltaData = [];
      }
      if (indicator.cvdData) {
        indicator.cvdData = [];
      }
    });
  }

  // --------------------------------------------------
  // Realtime Zone Polling
  // --------------------------------------------------

  /**
   * Verifica si el servicio realtime de zonas esta corriendo y auto-inicia el polling.
   */
  async _checkAndStartRealtimeZonePolling() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.running) {
        log.info(`[${this.symbol}] Servicio realtime de zonas activo - iniciando polling`);
        this.startRealtimeZonePolling();
      }
    } catch (e) {
      // Backend no disponible - no hacer nada
    }
  }

  /**
   * Inicia polling de zonas detectadas en tiempo real por el backend.
   * Consulta /api/zones/realtime/zones/{symbol} y actualiza el ZoneVisualizer.
   */
  startRealtimeZonePolling(intervalMs = 15000) {
    this.stopRealtimeZonePolling();
    this._realtimeZoneEnabled = true;
    this._lastRealtimeZoneFingerprint = '';

    log.info(`[${this.symbol}] Realtime zone polling iniciado (cada ${intervalMs / 1000}s)`);

    // Primera consulta inmediata
    this._fetchRealtimeZones();
    this._fetchZoneMetrics();

    this._realtimeZoneTimerId = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      this._fetchRealtimeZones();
      this._fetchZoneMetrics();
    }, intervalMs);
  }

  /**
   * Detiene polling de zonas realtime.
   */
  stopRealtimeZonePolling() {
    if (this._realtimeZoneTimerId) {
      clearInterval(this._realtimeZoneTimerId);
      this._realtimeZoneTimerId = null;
    }
    this._realtimeZoneEnabled = false;
  }

  /**
   * Fetch zonas realtime del backend y actualiza el ZoneVisualizer.
   */
  async _fetchRealtimeZones() {
    if (!this._realtimeZoneEnabled || !this.zoneVisualizerIndicator) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/zones/${this.symbol}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success) return;

      const zones = data.zones || [];

      // Generar fingerprint para detectar cambios (count + resultados + timestamps)
      const fingerprint = zones.map(z => `${z.start_timestamp}_${z.trade_result}`).join('|');
      if (fingerprint !== this._lastRealtimeZoneFingerprint) {
        log.info(`[${this.symbol}] Realtime zones actualizadas: ${zones.length} zonas`);
        this._lastRealtimeZoneFingerprint = fingerprint;
        this.zoneVisualizerIndicator.setRealtimeZones(zones);

        // Forzar redraw del chart
        if (this.requestRedraw) {
          this.requestRedraw();
        }
      }
    } catch (e) {
      // Silenciar errores de red (backend puede no estar corriendo)
    }
  }

  /**
   * Inicia polling independiente de metricas del Zone Detector.
   */
  _startZoneMetricsPolling(intervalMs = 30000) {
    this._stopZoneMetricsPolling();
    // Primer fetch ya se hizo en refresh(), solo iniciar timer
    this._zoneMetricsTimerId = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      this._fetchZoneMetrics();
    }, intervalMs);
  }

  /**
   * Detiene polling de metricas del Zone Detector.
   */
  _stopZoneMetricsPolling() {
    if (this._zoneMetricsTimerId) {
      clearInterval(this._zoneMetricsTimerId);
      this._zoneMetricsTimerId = null;
    }
  }

  /**
   * Fetch metricas por candle del Zone Detector (ATR, Band, TTM, BBWP).
   */
  async _fetchZoneMetrics() {
    if (!this.zoneVisualizerIndicator) return;
    try {
      // Sincronizar interval/days del chart con el ZoneVisualizer
      this.zoneVisualizerIndicator.interval = this.interval;
      this.zoneVisualizerIndicator.days = this.days;

      await this.zoneVisualizerIndicator.fetchMetrics();
      // Forzar redraw para pintar las barras
      if (this.requestRedraw) {
        this.requestRedraw();
      }
    } catch (e) {
      // Silenciar errores
    }
  }

  /**
   * 🚀 Inicia polling en todos los indicadores después de carga completa
   */
  startAllPolling() {
    log.info(`[${this.symbol}] startAllPolling() llamado - ${this.indicators.length} indicadores`);
    const swingInd = this.indicators.find(i => i.name === 'Swing Detector');
    console.log(`[${this.symbol}] [SWING] startAllPolling(): Swing Detector ${swingInd ? `found (enabled=${swingInd.enabled}, hasStartPolling=${!!swingInd.startPollingIfReady})` : 'NOT FOUND'}`);

    this.indicators.forEach(indicator => {
      if (indicator.startPollingIfReady) {
        log.info(`[${this.symbol}] -> Llamando startPollingIfReady() para ${indicator.name}`);
        indicator.startPollingIfReady();
      }
    });

    // Auto-detectar si el servicio realtime de zonas esta corriendo
    this._checkAndStartRealtimeZonePolling();

    // Polling independiente de metricas del Zone Detector (cada 30s)
    this._startZoneMetricsPolling();

    log.info(`[${this.symbol}] 🚀 Polling iniciado para todos los indicadores`);
  }

  /**
   * 🛑 Detiene polling en todos los indicadores (cuando chart no es visible)
   */
  stopAllPolling() {
    log.info(`[${this.symbol}] 🛑 stopAllPolling() llamado - ${this.indicators.length} indicadores`);
    this.indicators.forEach(indicator => {
      if (indicator.stopPolling) {
        log.info(`[${this.symbol}] -> Llamando stopPolling() para ${indicator.name}`);
        indicator.stopPolling();
      }
    });
    this._stopZoneMetricsPolling();
    log.info(`[${this.symbol}] 🛑 Polling detenido para todos los indicadores`);
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
      log.debug(`[${this.symbol}] 🎯 Rejection Pattern config updated`);
    }
  }

  /**
   * Fuerza la detección de patrones (útil después de cambiar configuración)
   */
  async detectRejectionPatterns() {
    const indicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (indicator && indicator.enabled) {
      await indicator.fetchData();
      log.trace(`[ Rejection patterns detected: ${indicator.getPatternCount()}`);
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
   * Obtiene el indicador de Swing Detector
   */
  getSwingDetectorIndicator() {
    return this.indicators.find(ind => ind.name === "Swing Detector");
  }

  /**
   * Obtiene el indicador de Volume Profile dinámico
   */
  getVolumeProfileIndicator() {
    return this.indicators.find(ind => ind.name === "Volume Profile");
  }

  /**
   * ✅ NUEVO: Obtiene el indicador de Support & Resistance
   */
  getSupportResistanceIndicator() {
    return this.supportResistanceIndicator;
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

  /**
   * 🎯 NUEVO: Obtiene el indicador VWAP
   */
  getVWAPIndicator() {
    return this.indicators.find(ind => ind.name === "VWAP");
  }

  /**
   * 🎯 NUEVO: Obtiene el indicador Zone Visualizer
   */
  getZoneVisualizerIndicator() {
    return this.zoneVisualizerIndicator;
  }

  /**
   * 🎯 NUEVO: Carga zonas de trading desde el backend y las visualiza
   * @param {object} params - Parámetros de detección de zonas
   * @returns {Promise<object>} - Resultado con zonas y estadísticas
   */
  async loadTradingZones(params = {}) {
    if (!this.zoneVisualizerIndicator) {
      log.warn(`[${this.symbol}] ZoneVisualizer no inicializado`);
      return { success: false, error: 'ZoneVisualizer no inicializado' };
    }

    try {
      // Usar days del parametro si se especifica, sino el del chart
      const requestDays = params.days || this.days;
      const requestBody = {
        symbol: this.symbol,
        interval: this.interval,
        days: requestDays,
        params: {
          // Metodo de deteccion
          detection_method: params.detection_method || "trading_zones",
          // Consolidation method
          consol_min_bars: params.consol_min_bars || 8,
          consol_max_bars: params.consol_max_bars || 50,
          consol_max_range_pct: params.consol_max_range_pct || 2.0,
          consol_atr_ratio: params.consol_atr_ratio || 0.6,
          consol_body_ratio: params.consol_body_ratio || 0.5,
          consol_max_outside_bars: params.consol_max_outside_bars || 3,
          lookforward_bars: params.lookforward_bars || 100,
          max_price_range_pct: params.max_price_range_pct || 5.0,
          entry_mode: params.entry_mode || "breakout_close",
          position_mode: params.position_mode || "sequential",
          swing_bars: params.swing_bars || 5,
          sl_mode: params.sl_mode || "zone_opposite",
          // ATR Dynamic method (nuevo)
          atr_dyn_period: params.atr_dyn_period || 200,
          atr_dyn_ma_period: params.atr_dyn_ma_period || 20,
          atr_dyn_min_bars: params.atr_dyn_min_bars || 0,
          atr_dyn_multiplier: params.atr_dyn_multiplier || 1.0,
          atr_dyn_max_breakout: params.atr_dyn_max_breakout || 5,
          atr_dyn_merge_overlap: params.atr_dyn_merge_overlap !== false,
          // Capas v3.0
          use_atr_band: params.use_atr_band || false,
          atr_band_period: params.atr_band_period || 200,
          atr_band_multiplier: params.atr_band_multiplier || 1.0,
          atr_band_ma_period: params.atr_band_ma_period || 20,
          use_reentry: params.use_reentry || false,
          max_reentry_bars: params.max_reentry_bars || 3,
          use_ttm_prefilter: params.use_ttm_prefilter || false,
          ttm_atr_length: params.ttm_atr_length || 20,
          ttm_kc_multiplier: params.ttm_kc_multiplier || 1.5,
          ttm_min_squeeze_bars: params.ttm_min_squeeze_bars || 5,
          use_bbwp_scoring: params.use_bbwp_scoring || false,
          bbwp_lookback: params.bbwp_lookback || 252,
          bbwp_squeeze_threshold: params.bbwp_squeeze_threshold || 20,
          bbwp_history_days: params.bbwp_history_days || 0,
          use_inside_pct_filter: params.use_inside_pct_filter || false,
          min_inside_pct: params.min_inside_pct || 70.0,
          // Filtro de calidad
          min_score_filter: params.min_score_filter || 0,
          // Score intrinseco (sin sesgos post-trade)
          use_continuation_score: params.use_continuation_score || false,
          // Volume Profile por zona (para va_breakout)
          sl_poc_buffer_pct: params.sl_poc_buffer_pct != null ? params.sl_poc_buffer_pct : 50.0,
          vp_bins_per_zone: params.vp_bins_per_zone || 30,
        }
      };

      const fetchUrl = `${API_BASE_URL}/api/zones/detect`;
      log.info(`[${this.symbol}] Cargando zonas: days=${requestDays}, interval=${this.interval}`);
      log.info(`[${this.symbol}] URL: ${fetchUrl}`);

      // Callback de progreso (si se paso)
      const onProgress = params._onProgress || null;
      if (onProgress) onProgress({ phase: 'fetching', message: 'Enviando request al backend...' });

      // Timeout largo: 120 dias en 5m = ~35K velas, puede tardar 30-90s
      const controller = new AbortController();
      const timeoutMs = 5 * 60 * 1000; // 5 minutos max
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const startTime = Date.now();
      let response;
      try {
        response = await fetch(fetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        log.error(`[${this.symbol}] Fetch FALLO: ${fetchError.name}: ${fetchError.message}`);
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.info(`[${this.symbol}] Respuesta recibida en ${elapsed}s, status=${response.status}`);

      if (onProgress) onProgress({ phase: 'processing', message: `Procesando respuesta (${elapsed}s)...` });

      const result = await response.json();

      if (result.success && result.zones) {
        this.zoneVisualizerIndicator.setZones(result.zones);
        // Sincronizar params de deteccion para que fetchMetrics los use
        this.zoneVisualizerIndicator.setDetectionParams(params);
        log.info(`[${this.symbol}] ${result.zones.length} zonas cargadas (${result.candles_count || '?'} velas analizadas)`);

        return {
          success: true,
          zones: result.zones,
          stats: result.stats,
          candles_count: result.candles_count
        };
      } else {
        log.warn(`[${this.symbol}] Error cargando zonas: ${result.error}`);
        return { success: false, error: result.error || 'Error desconocido' };
      }
    } catch (error) {
      log.error(`[${this.symbol}] Error en loadTradingZones:`, error.message || error);
      let errorMsg = error.message || 'Error desconocido';
      if (error.name === 'AbortError') {
        errorMsg = `Timeout: la deteccion tardo mas de 5 minutos. Intenta con menos dias.`;
      } else if (errorMsg === 'Failed to fetch') {
        errorMsg = `No se pudo conectar al backend (${API_BASE_URL}). Verifica que este corriendo.`;
      }
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Ejecuta optimizacion de parametros (grid search).
   * @param {object} opts - { days, base_params, param_ranges, metric, top_n, onProgress, onComplete, onError }
   * @returns {Promise<void>}
   */
  async estimateOptimization(opts = {}) {
    const { days, base_params = {}, param_ranges = {} } = opts;

    const requestBody = {
      symbol: this.symbol,
      interval: this.interval,
      days: days || this.days,
      base_params,
      param_ranges
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/zones/optimize-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error.message || 'Error de conexion' };
    }
  }

  async optimizeTradingZones(opts = {}) {
    const {
      days, base_params = {}, param_ranges = {},
      metric = 'expectancy', top_n = 10,
      onProgress, onComplete, onError
    } = opts;

    const requestBody = {
      symbol: this.symbol,
      interval: this.interval,
      days: days || this.days,
      base_params,
      param_ranges,
      metric,
      top_n
    };

    log.info(`[${this.symbol}] Optimizacion: ${Object.keys(param_ranges).length} params, metric=${metric}`);

    try {
      // Timeout largo: optimizacion puede tardar muchos minutos con muchas combinaciones
      const controller = new AbortController();
      const timeoutMs = 60 * 60 * 1000; // 60 minutos max
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${API_BASE_URL}/api/zones/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error || `HTTP ${response.status}`;
        if (onError) onError(errMsg);
        return;
      }

      const data = await response.json();

      if (data.success) {
        log.info(`[${this.symbol}] Optimizacion completada: ${data.total_combos} combos en ${data.elapsed}s`);
        if (onComplete) onComplete(data);
      } else {
        if (onError) onError(data.error || 'Error desconocido');
      }
    } catch (error) {
      log.error(`[${this.symbol}] Error en optimizacion:`, error.message);
      let errMsg = error.message || 'Error de conexion';
      if (error.name === 'AbortError') {
        errMsg = 'Timeout: la optimizacion tardo mas de 60 minutos.';
      }
      if (onError) onError(errMsg);
    }
  }

  /**
   * Exporta las zonas actualmente cargadas a CSV (endpoint separado)
   * @param {object} params - symbol, interval, days, zones, params usados en la deteccion
   * @returns {Promise<object>} - { success, csv_path, zones_exported }
   */
  async exportZonesCsv(params = {}) {
    try {
      const zones = this.zoneVisualizerIndicator ? this.zoneVisualizerIndicator.getZones() : [];
      if (!zones || zones.length === 0) {
        return { success: false, error: 'No hay zonas para exportar' };
      }

      const requestBody = {
        symbol: params.symbol || this.symbol,
        interval: params.interval || this.interval,
        days: params.days || this.days,
        zones: zones,
        params: params.detectionParams || {}
      };

      const response = await fetch(`${API_BASE_URL}/api/zones/export-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      if (result.success) {
        log.info(`[${this.symbol}] CSV exportado: ${result.csv_path} (${result.zones_exported} zonas)`);
      }
      return result;
    } catch (error) {
      log.error(`[${this.symbol}] Error exportando CSV:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envia alerta de una zona al TradingBot via backend del Analizador.
   * @param {object} zone - Datos de la zona con breakout
   * @param {string} tradingBotUrl - URL del TradingBot (default: localhost:5000)
   * @returns {Promise<object>} - Resultado del envio
   */
  async sendZoneAlert(zone, tradingBotUrl = 'http://localhost:5000', orderType = 'market') {
    try {
      const requestBody = {
        symbol: this.symbol,
        direction: zone.breakout_direction || '',
        entry_price: zone.entry_price || 0,
        sl_price: zone.sl_price || 0,
        tp_price: zone.tp_price || 0,
        confidence: zone.trading_score || 70,
        entry_mode: zone.entry_mode || 'breakout_close',
        trading_bot_url: tradingBotUrl,
        order_type: orderType
      };

      const response = await fetch(`${API_BASE_URL}/api/zones/send-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      if (result.success) {
        log.info(`[${this.symbol}] Alerta zona enviada: ${zone.breakout_direction} @ ${zone.entry_price}`);
      } else {
        log.warn(`[${this.symbol}] Alerta zona rechazada: ${result.error}`);
      }
      return result;
    } catch (error) {
      log.error(`[${this.symbol}] Error enviando alerta zona:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envia alertas de multiples zonas al TradingBot via backend del Analizador.
   * Solo envia zonas con entry_price, sl_price y tp_price validos.
   * @param {Array} zones - Lista de zonas detectadas
   * @param {string} entryMode - Modo de entrada usado en la deteccion
   * @param {string} tradingBotUrl - URL del TradingBot
   * @param {string} orderType - 'market' o 'limit'
   * @returns {Promise<object>} - Resultado batch
   */
  async sendZoneAlertsBatch(zones, entryMode = 'breakout_close', tradingBotUrl = 'http://localhost:5000', orderType = 'market') {
    try {
      const requestBody = {
        symbol: this.symbol,
        zones: zones,
        entry_mode: entryMode,
        trading_bot_url: tradingBotUrl,
        order_type: orderType
      };

      const response = await fetch(`${API_BASE_URL}/api/zones/send-alerts-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      if (result.success) {
        log.info(`[${this.symbol}] Alertas batch: ${result.sent} enviadas, ${result.failed} fallidas`);
      } else {
        log.warn(`[${this.symbol}] Alertas batch fallaron: ${result.error}`);
      }
      return result;
    } catch (error) {
      log.error(`[${this.symbol}] Error enviando alertas batch:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Limpia las zonas del visualizador
   */
  clearTradingZones() {
    if (this.zoneVisualizerIndicator) {
      this.zoneVisualizerIndicator.clearZones();
      log.info(`[${this.symbol}] Zonas limpiadas`);
    }
  }

  /**
   * 🎯 NUEVO: Obtiene el indicador de Fibonacci
   */
  getFibonacciIndicator() {
    return this.indicators.find(ind => ind.name === "Fibonacci");
  }

  /**
   * 🎯 NUEVO: Obtiene el indicador de Continuation Patterns
   */
  getContinuationPatternIndicator() {
    return this.indicators.find(ind => ind.name === "Continuation Patterns");
  }

  /**
   * 🎯 NUEVO: Obtiene el Level Source Manager
   */
  getLevelSourceManager() {
    return this.levelSourceManager;
  }

  /**
   * 🎯 NUEVO: Obtiene un indicador por nombre
   */
  getIndicator(name) {
    return this.indicators.find(ind => ind.name === name);
  }

  /**
   * 🎯 NUEVO: Obtiene múltiples indicadores por tipo (para fixed ranges)
   */
  getIndicatorsByType(type) {
    if (type === 'VolumeProfileFixedRange') {
      return this.fixedRangeIndicators;
    }
    return this.indicators.filter(ind => ind.constructor.name === type);
  }

  /**
   * Handler para cuando se cargan las velas históricas iniciales
   * Se llama UNA vez cuando el histórico está disponible
   */
  onHistoricalCandlesLoaded(allCandles) {
    // ✅ Guardar referencia a las velas
    this.allCandles = allCandles;

    // ✅ Si DBT está habilitado y no ha hecho fetchData(), hacerlo ahora con las velas
    const dbtIndicator = this.indicators.find(ind => ind.name === "Double Top/Bottom");
    if (dbtIndicator && dbtIndicator.enabled && !dbtIndicator.hasRunFullAnalysis) {
      log.info(`[${this.symbol}] 📊 Velas históricas cargadas (${allCandles.length} velas) - iniciando análisis DBT completo`);

      // Llamar fetchData con las velas disponibles
      dbtIndicator.fetchData(allCandles).then(() => {
        log.debug(`[${this.symbol}] ✅ Análisis DBT inicial completado - patterns: ${dbtIndicator.patterns?.length || 0}`);
        if (this.requestRedraw) {
          this.requestRedraw();
        }
      }).catch(err => {
        log.error(`[${this.symbol}] ❌ Error en análisis DBT inicial:`, err);
      });
    }
  }

  /**
   * Handler llamado cuando una vela se cierra (WebSocket confirm=true)
   * Propaga el evento a los indicadores que necesitan actualizarse en tiempo real
   */
  onCandleClose(allCandles) {
    // Guardar referencia a las velas para fetchData()
    this.allCandles = allCandles;

    // Double Top/Bottom
    const dbtIndicator = this.indicators.find(ind => ind.name === "Double Top/Bottom");
    if (dbtIndicator && dbtIndicator.enabled) {
      dbtIndicator.onCandleClose(allCandles);
    }

    // VWAP - actualizar al cierre de vela para datos frescos
    const vwapIndicator = this.indicators.find(ind => ind.name === "VWAP");
    if (vwapIndicator && vwapIndicator.enabled && vwapIndicator.fetchData) {
      vwapIndicator.fetchData(true); // true = skip cache, forzar fetch
    }

    // Swing Detector - actualizar al cierre de vela
    const swingIndicator = this.indicators.find(ind => ind.name === "Swing Detector");
    if (swingIndicator && swingIndicator.enabled && swingIndicator.fetchSignals) {
      swingIndicator.fetchSignals(true); // true = forceRefresh
    }
  }

  /**
   * Obtiene todos los niveles de referencia de todas las fuentes disponibles
   * Clasificados en highs importantes, lows importantes, y pivots
   *
   * @param {Object} options - Opciones de configuración
   * @param {Array} options.manualLevels - Array de drawings/horizontal lines
   * @param {number} options.currentPrice - Precio actual para clasificar niveles ambiguos
   * @param {Object} options.sources - Qué fuentes incluir {volumeProfile, fixedRanges, clusters, manualLevels, supportResistance, rangeDetection}
   * @returns {Object} {importantHighs: [], importantLows: [], pivots: []}
   */
  getAllReferenceLevels(options = {}) {
    const {
      manualLevels = [],
      currentPrice = null,
      sources = {
        volumeProfile: false,         // VP dinámico - no usado
        fixedRanges: true,
        clusters: true,
        manualLevels: true,
        supportResistance: true,
        rangeDetection: true,
        manualPriceZones: true        // Zonas manuales (NUEVO)
      }
    } = options;

    // ✅ NUEVO: Generar cache key
    const rejectionPatternIndicator = this.getRejectionPatternIndicator();
    const activeManualZonesCount = rejectionPatternIndicator?.config?.manualPriceZones?.filter(z => z.enabled).length || 0;

    const cacheKey = JSON.stringify({
      sources,
      manualLevelsCount: manualLevels.length,
      currentPrice: currentPrice ? Math.round(currentPrice) : null,
      fixedRangesCount: this.fixedRangeIndicators.length,
      activeManualZonesCount: activeManualZonesCount
    });

    // ✅ NUEVO: Usar cache si está disponible (válido por 1 segundo)
    const now = Date.now();
    if (this._referenceLevelsCacheKey === cacheKey &&
        this._referenceLevelsCache &&
        (now - this._lastCacheTime) < 1000) {
      return this._referenceLevelsCache;
    }

    // ✅ Solo loggear cuando hay cambio de cache (no en cada llamada)
    const isNewCalculation = this._referenceLevelsCacheKey !== cacheKey;
    if (isNewCalculation) {
      log.trace(`[ getAllReferenceLevels() RECALCULATING (cache miss)`);
      log.debug(`[${this.symbol}] 📍 Current price:`, currentPrice);
    }

    const importantHighs = [];
    const importantLows = [];
    const pivots = [];

    // 1. VOLUME PROFILE DINÁMICO (POC/VAH/VAL)
    if (sources.volumeProfile) {
      const vpData = this.getDynamicVolumeProfileData();
      if (vpData) {
        // VAH siempre es un high importante (resistencia)
        if (vpData.vah) {
          importantHighs.push({
            price: vpData.vah,
            source: 'VP_Dynamic',
            type: 'VAH',
            strength: 10,
            color: '#9C27B0'
          });
        }

        // VAL siempre es un low importante (soporte)
        if (vpData.val) {
          importantLows.push({
            price: vpData.val,
            source: 'VP_Dynamic',
            type: 'VAL',
            strength: 10,
            color: '#9C27B0'
          });
        }

        // POC es ambiguo - agregarlo como pivot
        if (vpData.poc) {
          pivots.push({
            price: vpData.poc,
            source: 'VP_Dynamic',
            type: 'POC',
            strength: 10,
            color: '#F44336'
          });
        }
      }
    }

    // 2. FIXED RANGE PROFILES (POC/VAH/VAL + Clusters)
    if (sources.fixedRanges || sources.clusters) {
      this.fixedRangeIndicators.forEach(indicator => {
        if (!indicator.enabled || !indicator.profile) return;

        const rangeLabel = indicator.rangeLabel || indicator.rangeId;

        // POC/VAH/VAL de fixed ranges
        if (sources.fixedRanges) {
          if (indicator.profile.poc?.price) {
            pivots.push({
              price: indicator.profile.poc.price,
              source: 'VP_Fixed',
              type: 'POC',
              rangeId: indicator.rangeId,
              rangeLabel: rangeLabel,
              strength: 9,
              color: indicator.pocColor || '#F44336'
            });
          }

          if (indicator.profile.valueArea?.vahPrice) {
            importantHighs.push({
              price: indicator.profile.valueArea.vahPrice,
              source: 'VP_Fixed',
              type: 'VAH',
              rangeId: indicator.rangeId,
              rangeLabel: rangeLabel,
              strength: 9,
              color: indicator.vahValColor || '#9C27B0'
            });
          }

          if (indicator.profile.valueArea?.valPrice) {
            importantLows.push({
              price: indicator.profile.valueArea.valPrice,
              source: 'VP_Fixed',
              type: 'VAL',
              rangeId: indicator.rangeId,
              rangeLabel: rangeLabel,
              strength: 9,
              color: indicator.vahValColor || '#9C27B0'
            });
          }
        }

        // Clusters de fixed ranges
        if (sources.clusters) {
          const clusters = indicator.getClusters();
          clusters.forEach(cluster => {
            // Clasificar cluster según posición relativa al precio actual
            if (currentPrice) {
              if (cluster.price > currentPrice * 1.001) {
                // Cluster por encima → resistencia
                importantHighs.push({
                  price: cluster.price,
                  source: 'VP_Cluster',
                  type: 'CLUSTER',
                  rangeId: indicator.rangeId,
                  rangeLabel: rangeLabel,
                  strength: cluster.strength,
                  volume: cluster.volume,
                  color: indicator.clusterColor || '#E65100'
                });
              } else if (cluster.price < currentPrice * 0.999) {
                // Cluster por debajo → soporte
                importantLows.push({
                  price: cluster.price,
                  source: 'VP_Cluster',
                  type: 'CLUSTER',
                  rangeId: indicator.rangeId,
                  rangeLabel: rangeLabel,
                  strength: cluster.strength,
                  volume: cluster.volume,
                  color: indicator.clusterColor || '#E65100'
                });
              } else {
                // Cluster muy cerca del precio → pivot
                pivots.push({
                  price: cluster.price,
                  source: 'VP_Cluster',
                  type: 'CLUSTER',
                  rangeId: indicator.rangeId,
                  rangeLabel: rangeLabel,
                  strength: cluster.strength,
                  volume: cluster.volume,
                  color: indicator.clusterColor || '#E65100'
                });
              }
            } else {
              // Sin precio actual, agregar como pivot
              pivots.push({
                price: cluster.price,
                source: 'VP_Cluster',
                type: 'CLUSTER',
                rangeId: indicator.rangeId,
                rangeLabel: rangeLabel,
                strength: cluster.strength,
                volume: cluster.volume,
                color: indicator.clusterColor || '#E65100'
              });
            }
          });
        }
      });
    }

    // 3. RANGE DETECTION (Boundaries)
    if (sources.rangeDetection) {
      const rangeDetector = this.indicators.find(ind => ind.name === "Range Detection");
      if (rangeDetector && rangeDetector.enabled && rangeDetector.consolidationRanges) {
        rangeDetector.consolidationRanges.forEach(range => {
          // Range high es resistencia
          if (range.high) {
            importantHighs.push({
              price: range.high,
              source: 'Range_Detection',
              type: 'RANGE_HIGH',
              rangeLabel: range.label,
              strength: 8,
              color: '#9C27B0'
            });
          }

          // Range low es soporte
          if (range.low) {
            importantLows.push({
              price: range.low,
              source: 'Range_Detection',
              type: 'RANGE_LOW',
              rangeLabel: range.label,
              strength: 8,
              color: '#9C27B0'
            });
          }
        });
      }
    }

    // 4. SUPPORT & RESISTANCE (Solo lectura, sin modificar)
    if (sources.supportResistance) {
      const srIndicator = this.indicators.find(ind => ind.name === "Support & Resistance");
      if (srIndicator && srIndicator.enabled) {
        // Resistances
        if (srIndicator.resistances && Array.isArray(srIndicator.resistances)) {
          srIndicator.resistances.forEach(resistance => {
            importantHighs.push({
              price: resistance.price,
              source: 'S&R',
              type: 'RESISTANCE',
              strength: resistance.strength || 5,
              touches: resistance.touches,
              color: '#F44336'
            });
          });
        }

        // Supports
        if (srIndicator.supports && Array.isArray(srIndicator.supports)) {
          srIndicator.supports.forEach(support => {
            importantLows.push({
              price: support.price,
              source: 'S&R',
              type: 'SUPPORT',
              strength: support.strength || 5,
              touches: support.touches,
              color: '#4CAF50'
            });
          });
        }
      }
    }

    // 5. MANUAL LEVELS (Horizontal lines from drawings)
    // ⚠️ IMPORTANTE: Si hay zonas manuales activas, NO incluir líneas horizontales
    // para evitar mezclar referencias de diferentes fuentes
    const hasActiveManualZones = activeManualZonesCount > 0;

    if (sources.manualLevels && manualLevels && manualLevels.length > 0) {
      if (hasActiveManualZones && isNewCalculation) {
        log.debug(`[${this.symbol}]   ⏭️ Skipping ${manualLevels.length} manual horizontal lines (${activeManualZonesCount} manual zones active)`);
      } else if (!hasActiveManualZones) {
        manualLevels.forEach(drawing => {
          if (drawing.type === 'horizontal' && drawing.price) {
            // Clasificar según posición relativa al precio actual
            if (currentPrice) {
              if (drawing.price > currentPrice * 1.001) {
                importantHighs.push({
                  price: drawing.price,
                  source: 'Manual',
                  type: 'HORIZONTAL_LINE',
                  drawingId: drawing.id,
                  strength: 7,
                  color: drawing.style?.color || '#8B5CF6'
                });
              } else if (drawing.price < currentPrice * 0.999) {
                importantLows.push({
                  price: drawing.price,
                  source: 'Manual',
                  type: 'HORIZONTAL_LINE',
                  drawingId: drawing.id,
                  strength: 7,
                  color: drawing.style?.color || '#8B5CF6'
                });
              } else {
                pivots.push({
                  price: drawing.price,
                  source: 'Manual',
                  type: 'HORIZONTAL_LINE',
                  drawingId: drawing.id,
                  strength: 7,
                  color: drawing.style?.color || '#8B5CF6'
                });
              }
            } else {
              // Sin precio actual, agregar como pivot
              pivots.push({
                price: drawing.price,
                source: 'Manual',
                type: 'HORIZONTAL_LINE',
                drawingId: drawing.id,
                strength: 7,
                color: drawing.style?.color || '#8B5CF6'
              });
            }
          }
        });
      }
    }

    // 6. MANUAL PRICE ZONES (NUEVO)
    if (sources.manualPriceZones) {
      if (rejectionPatternIndicator?.config?.manualPriceZones) {
        rejectionPatternIndicator.config.manualPriceZones.forEach(zone => {
          if (!zone.enabled) return;

          // Usar el punto medio de la zona como precio de referencia
          const zoneMidPrice = (zone.minPrice + zone.maxPrice) / 2;

          const levelData = {
            price: zoneMidPrice,
            source: 'Manual_Zone',
            type: 'PRICE_ZONE',
            zoneId: zone.id,
            zoneName: zone.name,
            minPrice: zone.minPrice,
            maxPrice: zone.maxPrice,
            strength: zone.strength || 8,
            signalDirection: zone.signalDirection || null,
            color: zone.color || '#FF5722'
          };

          // Clasificar según posición relativa al precio actual
          if (currentPrice) {
            if (zoneMidPrice > currentPrice * 1.001) {
              importantHighs.push(levelData);
            } else if (zoneMidPrice < currentPrice * 0.999) {
              importantLows.push(levelData);
            } else {
              pivots.push(levelData);
            }
          } else {
            // Sin precio actual, agregar como pivot
            pivots.push(levelData);
          }
        });
      }
    }

    // Ordenar por precio (descendente para highs, ascendente para lows)
    importantHighs.sort((a, b) => b.price - a.price);
    importantLows.sort((a, b) => a.price - b.price);
    pivots.sort((a, b) => a.price - b.price);

    const totalLevels = importantHighs.length + importantLows.length + pivots.length;

    const result = {
      importantHighs,
      importantLows,
      pivots,
      totalLevels
    };

    // ✅ NUEVO: Guardar resultado en cache
    this._referenceLevelsCache = result;
    this._referenceLevelsCacheKey = cacheKey;
    this._lastCacheTime = now;

    // Solo loggear cuando recalculamos (no en cache hits)
    if (isNewCalculation) {
      log.debug(`[${this.symbol}] 📊 getAllReferenceLevels() COMPLETE - Total levels: ${totalLevels} (${importantHighs.length} highs, ${importantLows.length} lows, ${pivots.length} pivots)`);
    }

    return result;
  }
}

export default IndicatorManager;
