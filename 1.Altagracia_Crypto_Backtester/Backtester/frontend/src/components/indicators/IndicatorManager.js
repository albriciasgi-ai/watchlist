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
import SupportResistance2Indicator from "./SupportResistance2Indicator";
import OpenInterestIndicator from "./OpenInterestIndicator";
import VWAPIndicator from "./VWAPIndicator";
import DoubleTopBottomIndicator from "./DoubleTopBottomIndicator";
import SwingDetectorIndicator from "./SwingDetectorIndicator"; // 🎯 Swing High/Low
import OIVolumeConfluenceIndicator from "./OIVolumeConfluenceIndicator"; // 🎯 OI-Volume Confluence
import OrderFlowIndicator from "./OrderFlowIndicator"; // 🎯 Order Flow (Footprints)
import FVGIndicator from "./FVGIndicator";
import VolumeProfilePeriodicIndicator from "./VolumeProfilePeriodicIndicator";
import ResponseVolumeIndicator from "./ResponseVolumeIndicator";
import { SessionProfiles } from "./sessionProfile.js";
import { MIN_PANEL_HEIGHT, clearPanelLayout, movePanel, orderPanels, panelLayout, savePanelLayout } from "./panelLayout.js";


class IndicatorManager {
  constructor(symbol, interval, days = 30) {
    this.symbol = symbol;
    this.interval = interval;
    this.days = days;
    this.indicators = [];
    this.heightScale = 1.0;
    this.panelLayout = panelLayout(symbol);
    this.fixedRangeProfiles = [];
    this.fixedRangeIndicators = []; // ✅ Instancias de fixed ranges

    // 🎯 NUEVO: Range Detection System
    this.rangeDetector = null;       // Detector de rangos (solo si está habilitado)
    this.autoRangeProfiles = [];     // Rangos auto-detectados

    // 📊 NUEVO: Support & Resistance Indicator
    this.supportResistanceIndicator = null; // Indicador de S/R (solo si está habilitado)

    // 📊 NUEVO: Support & Resistance v2 (Swing Points Based)
    this.supportResistance2Indicator = null;

    // 📊 NUEVO: Open Interest Indicator
    this.openInterestIndicator = null; // Indicador de Open Interest (solo si está habilitado)


    console.log(`[${this.symbol}] 🔧 IndicatorManager: Inicializando con ${days} días @ ${interval}`);
  }

  async initialize(backtestingMode = false, simulationStartTime = null) {
    // 🎯 Guardar modo backtesting para usarlo en otros métodos
    this.backtestingMode = backtestingMode;
    this.simulationStartTime = simulationStartTime; // 🎯 NUEVO: Fecha de inicio de la simulación
    this.allCandles = null; // 🎯 NUEVO: Almacenar referencia a todas las velas para precálculo

    // Crear el indicador de S/R
    this.supportResistanceIndicator = new SupportResistanceIndicator(this.symbol, this.interval, this.days);
    this.supportResistanceIndicator.localOnly = backtestingMode;

    // Crear el indicador de S/R v2 (Swing Points Based)
    this.supportResistance2Indicator = new SupportResistance2Indicator(this.symbol, this.interval, this.days);

    // Crear el indicador de Open Interest
    this.openInterestIndicator = new OpenInterestIndicator(this.symbol, this.interval, this.days);
    this.openInterestIndicator.requestRedraw = () => this.requestRedraw?.();


    // 🎯 Crear indicador de OI-Volume Confluence
    const volumeIndicator = new VolumeIndicator(this.symbol, this.interval, this.days);
    const confluenceIndicator = new OIVolumeConfluenceIndicator(this.symbol, this.interval, this.days);

    // Inyectar referencias de Volume y OI al indicador de confluencia
    confluenceIndicator.setIndicators(volumeIndicator, this.openInterestIndicator);

    // 🎯 Crear indicador de Order Flow con fecha de inicio de simulación
    this.orderFlowIndicator = new OrderFlowIndicator(this.symbol, this.interval, this.days, backtestingMode, simulationStartTime);
    this.fvgIndicator = new FVGIndicator(this.symbol, this.interval, this.days);
    const sessionProfiles = new SessionProfiles(this.symbol);
    this.vpPeriodicIndicator = new VolumeProfilePeriodicIndicator(this.symbol, this.interval, this.days, sessionProfiles);
    this.responseVolumeIndicator = new ResponseVolumeIndicator(this.symbol, this.interval, this.days);
    const doubleTopBottomIndicator = new DoubleTopBottomIndicator(this.symbol, this.interval, this.days, { backtestingMode });
    doubleTopBottomIndicator.requestRedraw = () => this.requestRedraw?.();
    volumeIndicator.setDeltaSource(this.orderFlowIndicator);

    this.indicators = [
      new VolumeProfileIndicator(this.symbol, this.interval, this.days),
      volumeIndicator,
      new CVDIndicator(this.symbol, this.interval, this.days),
      this.openInterestIndicator,
      confluenceIndicator, // 🎯 OI-Volume Confluence
      new RejectionPatternIndicator(this.symbol, this.interval, this.days, backtestingMode),
      doubleTopBottomIndicator,
      this.supportResistanceIndicator,
      this.supportResistance2Indicator,
      new VWAPIndicator(this.symbol, this.interval, this.days, { backtestingMode }),
      new SwingDetectorIndicator(this.symbol, this.interval, this.days), // 🎯 Swing High/Low
      this.orderFlowIndicator, // 🎯 Order Flow (Footprints)
      this.fvgIndicator,
      this.vpPeriodicIndicator,
      this.responseVolumeIndicator
    ];

    // Habilitar el indicador de patrones por defecto
    const patternIndicator = this.indicators.find(ind => ind.name === "Rejection Patterns");
    if (patternIndicator) {
      patternIndicator.enabled = true;
      patternIndicator.setShowMode('all'); // Mostrar todos los patrones por defecto
      patternIndicator.getRangeProfile = (rangeId) => this.fixedRangeIndicators.find(item => item.rangeId === rangeId)?.profile;
    }

    // 🎯 Conectar SwingDetector con VWAPIndicator para el filtro VWAP
    const swingDetector = this.indicators.find(ind => ind.name === "Swing Detector");
    const vwapIndicator = this.indicators.find(ind => ind.name === "VWAP");
    if (swingDetector && vwapIndicator) {
      swingDetector.setVWAPIndicator(vwapIndicator);
    }
    if (swingDetector) {
      // Los rectángulos del gráfico marcan dónde actúa su filtro VWAP. Los que definen un VP Fixed no cuentan
      swingDetector.setDrawingManager(() => this.getDrawingManager?.());
      swingDetector.getProfileRectIds = () => new Set(this.getFixedRangeProfiles().map(profile => profile.sourceRectId).filter(Boolean));
    }

    // 🎯 OPTIMIZACIÓN: NO cargar datos de indicadores pesados aquí
    // updateIndicatorStates() se llamará después con los estados reales
    // y solo cargará los indicadores que realmente están habilitados
    //
    // Solo cargamos Volume Profile porque es crítico para la visualización inicial
    await Promise.all(
      this.indicators.map(ind => {
        // Volume Profile siempre se carga (es parte esencial del chart)
        if (ind.name === "Volume Profile") {
          console.log(`[${this.symbol}] Fetching data for ${ind.name} (siempre requerido)`);
          return ind.fetchData();
        }
        // Open Interest: solo si ya tiene datos precargados
        if (ind.name === "Open Interest" && ind._dataPreloaded) {
          console.log(`[${this.symbol}] Fetching data for ${ind.name} (datos precargados)`);
          return ind.fetchData();
        }
        // Los demás indicadores se cargarán on-demand en updateIndicatorStates()
        console.log(`[${this.symbol}] ⏳ Deferring load for ${ind.name} (lazy loading)`);
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


  /**
   * 🎯 NUEVO: Precalcular TODOS los indicadores con velas completas (modo backtesting)
   * @param {Array} candles - Todas las velas históricas del timeframe
   * @param {number} playbackStartTime - Timestamp de inicio del playback (para evitar sesgo de supervivencia)
   */
  async precalculateAllIndicators(candles, playbackStartTime = null) {
    if (!candles || candles.length === 0) {
      console.warn(`[${this.symbol}] No candles provided for precalculation`);
      return;
    }

    // 🎯 NUEVO: Guardar referencia a las velas para uso posterior (activación dinámica)
    this.allCandles = candles;

    const startTime = Date.now();
    console.log(`[${this.symbol}] 🚀 PRECALCULANDO todos los indicadores con ${candles.length} velas...`);
    if (playbackStartTime) {
      console.log(`[${this.symbol}] 📅 playbackStartTime: ${new Date(playbackStartTime).toISOString()}`);
    }

    try {
      const tasks = [];

      for (const indicator of this.indicators) {
        if (!indicator.enabled) {
          console.log(`[${this.symbol}] ⏭️  Saltando ${indicator.name} (deshabilitado)`);
          continue;
        }

        // DTB: usa precalculateWithCandles con playbackStartTime
        if (indicator.name === "Double Top/Bottom") {
          if (indicator.precalculateWithCandles) {
            console.log(`[${this.symbol}] 🔍 Precalculando ${indicator.name}...`);
            tasks.push(indicator.precalculateWithCandles(candles, playbackStartTime));
          }
        }
        // S&R: inicializar playback time para evitar sesgo de supervivencia
        if (indicator.name === "Support & Resistance" && playbackStartTime) {
          if (indicator.updatePlaybackDate) {
            console.log(`[${this.symbol}] 🎯 Inicializando S&R playbackTime: ${new Date(playbackStartTime).toISOString()}`);
            indicator.updatePlaybackDate(playbackStartTime);
          }
        }
      }

      // Esperar a que todos los precálculos terminen
      await Promise.all(tasks);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[${this.symbol}] ✅ PRECÁLCULO COMPLETADO en ${duration}s`);
      console.log(`[${this.symbol}] 📊 Indicadores listos para playback`);

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${this.symbol}] ❌ Error en precálculo después de ${duration}s:`, error);
      throw error;
    }
  }

  // ✅ SIMPLIFICADO: refresh solo para Volume Profile y Open Interest
  async refresh() {
    const startTime = Date.now();
    console.log(`[${this.symbol}] 🔄 Refrescando indicadores...`);

    try {
      await Promise.all(
        this.indicators.map(async (indicator) => {
          if (indicator.enabled && (indicator.name === "Volume Profile" || indicator.name === "Open Interest")) {
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

  /**
   * 🎯 NUEVO: Actualiza estados de indicadores SIN recrear el IndicatorManager
   * @param {Object} indicatorStates - Objeto con estados {indicatorName: true/false}
   * @param {boolean} backtestingMode - Si está en modo backtesting
   * @param {Array} candles - Velas del marco, para los indicadores que se calculan al activarse
   */
  async updateIndicatorStates(indicatorStates, backtestingMode = false, candles = null) {
    console.log(`[${this.symbol}] 🔄 Actualizando estados de indicadores:`, JSON.stringify(indicatorStates));

    if (candles?.length > 0) this.allCandles = candles;

    const promises = [];

    // 🎯 Indicadores que requieren datos del backend
    const backendIndicators = ["VWAP", "Open Interest", "Double Top/Bottom", "Support & Resistance", "Rejection Patterns", "Order Flow"];

    for (const indicator of this.indicators) {
      const shouldBeEnabled = indicatorStates[indicator.name] || false;
      const wasEnabled = indicator.enabled;

      // 🔍 DEBUG: Log para S&R específicamente
      if (indicator.name === "Support & Resistance") {
        console.log(`[${this.symbol}] 📊 S&R State Check: shouldBeEnabled=${shouldBeEnabled}, wasEnabled=${wasEnabled}, hasData=${(indicator.resistances?.length || 0) + (indicator.supports?.length || 0)}`);
      }

      // 🔍 DEBUG: Log para Open Interest específicamente
      if (indicator.name === "Open Interest") {
        console.log(`%c[${this.symbol}] 📊 OI State Check`, 'background: #FF9800; color: white; font-weight: bold; padding: 4px;', {
          shouldBeEnabled,
          wasEnabled,
          hasDataMap: !!indicator.dataMap,
          dataMapSize: indicator.dataMap?.size || 0,
          dataLength: indicator.data?.length || 0,
          isBackendIndicator: backendIndicators.includes(indicator.name)
        });
      }

      if (shouldBeEnabled && !wasEnabled) {
        // 🎯 Indicador se está ACTIVANDO
        console.log(`[${this.symbol}] ✅ Activando ${indicator.name}`);
        indicator.setEnabled(true);

        // 🎯 NUEVO: En modo backtesting, usar precalculateWithCandles para DTB
        if (backtestingMode && indicator.name === "Double Top/Bottom") {
          if (this.allCandles && this.allCandles.length > 0 && indicator.precalculateWithCandles) {
            console.log(`[${this.symbol}] 🔍 Precalculando ${indicator.name} (activación dinámica en backtesting) con ${this.allCandles.length} velas`);
            promises.push(indicator.precalculateWithCandles(this.allCandles));
          } else {
            console.warn(`[${this.symbol}] ⚠️ No hay velas disponibles para precalcular ${indicator.name}`);
          }
        }
        // 🎯 CRÍTICO: Si es VWAP u otro indicador que requiere datos del backend
        else if (backendIndicators.includes(indicator.name)) {
          // En modo normal o para otros indicadores, llamar fetchData()
          console.log(`[${this.symbol}] 🌐 Cargando datos para ${indicator.name} (activación dinámica)`);
          promises.push(indicator.fetchData());
        }
      } else if (!shouldBeEnabled && wasEnabled) {
        // 🎯 Indicador se está DESACTIVANDO
        console.log(`[${this.symbol}] ❌ Desactivando ${indicator.name}`);
        indicator.setEnabled(false);
      } else if (shouldBeEnabled && wasEnabled) {
        // 🎯 FIX v2: Si ya estaba habilitado pero no tiene datos, intentar cargar
        // Esto soluciona el caso donde el indicador tiene enabled=true por defecto
        // pero el fetch inicial no se ejecutó (ahora usamos lazy loading)
        if (backendIndicators.includes(indicator.name)) {
          // S&R: verificar si tiene datos
          if (indicator.name === "Support & Resistance") {
            if ((!indicator.resistances || indicator.resistances.length === 0) &&
                (!indicator.supports || indicator.supports.length === 0)) {
              console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
              promises.push(indicator.fetchData());
            }
          }
          // VWAP: verificar si tiene datos
          else if (indicator.name === "VWAP") {
            if (!indicator.vwapData || Object.keys(indicator.vwapData || {}).length === 0) {
              console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
              promises.push(indicator.fetchData());
            }
          }
          // DTB: verificar si tiene patrones (en modo NO backtesting)
          else if (indicator.name === "Double Top/Bottom" && !backtestingMode) {
            if (!indicator.patterns || indicator.patterns.length === 0) {
              console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
              promises.push(indicator.fetchData());
            }
          }
          // DTB en backtesting: una sesión restaurada lo trae activo sin haberlo calculado
          else if (indicator.name === "Double Top/Bottom") {
            if (!indicator.candlesSentToBackend && !indicator.loading && this.allCandles?.length > 0) {
              promises.push(indicator.precalculateWithCandles(this.allCandles));
            }
          }
          // Rejection Patterns: verificar si tiene patrones
          else if (indicator.name === "Rejection Patterns") {
            if (!indicator.patterns || indicator.patterns.length === 0) {
              console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
              promises.push(indicator.fetchData());
            }
          }
          // Open Interest: verificar si tiene datos
          else if (indicator.name === "Open Interest") {
            const hasData = indicator.dataMap && indicator.dataMap.size > 0 && indicator.data.length > 0;
            console.log(`%c[${this.symbol}] 🔍 OI Data Validation`, 'background: #FF9800; color: white; padding: 4px;', {
              hasDataMap: !!indicator.dataMap,
              dataMapSize: indicator.dataMap?.size || 0,
              dataLength: indicator.data?.length || 0,
              hasData,
              willReload: !hasData
            });

            if (!hasData) {
              console.log(`%c[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`, 'background: #F44336; color: white; font-weight: bold; padding: 4px;');
              promises.push(indicator.fetchData());
            }
          }
          // Order Flow: verificar si tiene datos
          else if (indicator.name === "Order Flow") {
            const hasData = indicator.footprints && indicator.footprints.length > 0;
            if (!hasData) {
              console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
              promises.push(indicator.fetchData());
            }
          }
        }
      }
    }

    // Esperar a que todos los fetchData() o precalculateWithCandles() terminen
    await Promise.all(promises);
    console.log(`[${this.symbol}] ✅ Estados actualizados correctamente`);
  }

  async applyConfig(name, config, candles = null, playbackStartTime = null) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator && indicator.applyConfig) {
      // Una altura escrita en el modal reemplaza la que se arrastró en el gráfico
      if (config?.height !== undefined && config.height !== indicator.height) {
        delete this.panelLayout.heights[name];
        this.savePanels();
      }
      // 🎯 Si se proporcionan velas, usarlas y actualizarlas en allCandles
      if (candles && candles.length > 0) {
        this.allCandles = candles;
      }
      // 🎯 CRÍTICO: Pasar velas al indicador para permitir precálculo al habilitar
      // Si es DTB, también pasar playbackStartTime para evitar sesgo de supervivencia
      if (name === "Double Top/Bottom" && playbackStartTime) {
        await indicator.applyConfig(config, candles || this.allCandles, playbackStartTime);
      } else {
        await indicator.applyConfig(config, candles || this.allCandles);
      }
    }
  }

  /**
   * 🎯 NUEVO: Actualizar fecha de playback para indicadores con chunks (DTB)
   * @param {number} timestamp - Timestamp actual del playback
   */
  async updateDTBPlaybackDate(timestamp) {
    const dtbIndicator = this.indicators.find(ind => ind.name === "Double Top/Bottom");
    if (dtbIndicator && dtbIndicator.updatePlaybackDate) await dtbIndicator.updatePlaybackDate(timestamp);
  }

  /**
   * 🎯 Actualizar fecha de playback para Swing Detector
   * @param {number} timestamp - Timestamp actual del playback
   */
  updateSwingPlaybackTime(timestamp) {
    const swingIndicator = this.indicators.find(ind => ind.name === "Swing Detector");
    if (swingIndicator && swingIndicator.updatePlaybackTime) {
      swingIndicator.updatePlaybackTime(timestamp);
    }
  }

  /**
   * 🎯 Actualizar fecha de playback para Support & Resistance
   * @param {number} timestamp - Timestamp actual del playback
   */
  updateSRPlaybackTime(timestamp) {
    const srIndicator = this.indicators.find(ind => ind.name === "Support & Resistance");
    if (srIndicator && srIndicator.updatePlaybackDate) {
      srIndicator.updatePlaybackDate(timestamp);
    }
  }

  /**
   * 🎯 Actualizar fecha de playback para TODOS los indicadores que lo soporten
   * @param {number} timestamp - Timestamp actual del playback
   */
  async updateAllPlaybackTime(timestamp) {
    // DTB (async)
    const dtbIndicator = this.indicators.find(ind => ind.name === "Double Top/Bottom");
    if (dtbIndicator && dtbIndicator.updatePlaybackDate) {
      await dtbIndicator.updatePlaybackDate(timestamp);
    }

    // Swing Detector
    const swingIndicator = this.indicators.find(ind => ind.name === "Swing Detector");
    if (swingIndicator && swingIndicator.updatePlaybackTime) {
      swingIndicator.updatePlaybackTime(timestamp);
    }

    // Support & Resistance
    const srIndicator = this.indicators.find(ind => ind.name === "Support & Resistance");
    if (srIndicator && srIndicator.updatePlaybackDate) {
      srIndicator.updatePlaybackDate(timestamp);
    }
  }

  getIndicatorConfig(name) {
    const indicator = this.indicators.find(ind => ind.name === name);
    if (indicator && indicator.getConfig) {
      return indicator.getConfig();
    }
    return null;
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

  // Altura pedida para un panel: la que eligió el usuario o la de fábrica
  getRequestedHeight(indicator) {
    const height = indicator.getHeight();
    return height > 0 ? this.panelLayout.heights[indicator.name] ?? height : 0;
  }

  getTotalHeight() {
    return this.indicators.reduce((sum, ind) => sum + this.getRequestedHeight(ind), 0);
  }

  setHeightScale(scale) {
    this.heightScale = scale;
  }

  // Altura de un panel con la escala actual, sin bajar de lo legible
  getPanelHeight(indicator) {
    const height = this.getRequestedHeight(indicator);
    if (height <= 0) return 0;
    return Math.max(Math.min(height, MIN_PANEL_HEIGHT), Math.floor(height * this.heightScale));
  }

  getScaledHeight() {
    return this.indicators.reduce((sum, indicator) => sum + this.getPanelHeight(indicator), 0);
  }

  renderOverlays(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    // 🔍 DEBUG: Log de indicadores con renderOverlay
    const overlayIndicators = this.indicators.filter(i => i.renderOverlay);
    if (!this._overlayLogged) {
      console.log(`[${this.symbol}] 🎯 renderOverlays - Indicadores con overlay:`,
        overlayIndicators.map(i => `${i.name}(enabled=${i.enabled})`).join(', ')
      );
      const srInd = this.indicators.find(i => i.name === "Support & Resistance");
      if (srInd) {
        console.log(`[${this.symbol}] 📊 S&R Status: enabled=${srInd.enabled}, resistances=${srInd.resistances?.length || 0}, supports=${srInd.supports?.length || 0}`);
      }
      // 🔍 DEBUG: S&R v2
      const sr2Ind = this.indicators.find(i => i.name === "S&R v2");
      if (sr2Ind) {
        console.log(`[${this.symbol}] 📊 S&R v2 Status: enabled=${sr2Ind.enabled}, resistances=${sr2Ind.resistances?.length || 0}, supports=${sr2Ind.supports?.length || 0}`);
      }
      this._overlayLogged = true;
    }

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
          // No renderizar el Volume Profile dinámico
          if (indicator.hideWhenFixedRanges && hasActiveFixedRanges) return;
        }

        // Renderizar el indicador normalmente
        indicator.renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext);
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
    this.rangesAhead = new Set();
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

      // Un rango que termina después de la hora simulada viene de un análisis con velas posteriores
      if (priceContext?.knownCandles && profile.endTimestamp > priceContext.knownUntil) {
        this.rangesAhead.add(indicator);
        return false;
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

  /** Niveles a la vista que se pueden incluir en el análisis */
  getSelectableLevels() {
    const rangesActive = this.fixedRangeIndicators.some(item => item.enabled && item.symbol === this.symbol);
    return [...this.indicators, ...this.fixedRangeIndicators]
      .filter(indicator => indicator.enabled && indicator.selectableLevels && !this.rangesAhead?.has(indicator))
      .filter(indicator => !(indicator.hideWhenFixedRanges && rangesActive))
      .flatMap(indicator => indicator.selectableLevels());
  }

  /** Paneles a la vista, en el orden elegido */
  getPanels() {
    const panels = this.indicators.filter(indicator => indicator.enabled && indicator.render && indicator.getHeight() > 0);
    const names = orderPanels(panels.map(panel => panel.name), this.panelLayout.order);
    return names.map(name => panels.find(panel => panel.name === name));
  }

  /** Lugar de cada panel, apilados desde top */
  getPanelRects(top) {
    let y = top;
    return this.getPanels().map(indicator => {
      const rect = { name: indicator.name, top: y, height: this.getPanelHeight(indicator), requested: this.getRequestedHeight(indicator) };
      y += rect.height;
      return rect;
    });
  }

  movePanel(name, step) {
    const names = this.indicators.map(indicator => indicator.name);
    const visible = this.getPanels().map(panel => panel.name);
    this.panelLayout.order = movePanel(this.panelLayout.order, names, visible, name, step);
    this.savePanels();
  }

  setPanelHeight(name, height) {
    this.panelLayout.heights[name] = height;
  }

  savePanels() {
    savePanelLayout(this.symbol);
  }

  resetPanels() {
    clearPanelLayout(this.symbol);
  }

  renderIndicators(ctx, bounds, visibleCandles) {
    for (const { name, top, height } of this.getPanelRects(bounds.y)) {
      const indicator = this.indicators.find(item => item.name === name);
      indicator.render(ctx, { x: bounds.x, y: top, width: bounds.width, height }, visibleCandles);
    }
  }

  // ==================== FIXED RANGE PROFILES ====================

  createFixedRangeProfile(startTimestamp, endTimestamp, sourceRectId = null) {
    const rangeId = `range_${Date.now()}`;

    const newProfile = {
      rangeId: rangeId,
      symbol: this.symbol,
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      sourceRectId: sourceRectId,
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
        this.saveFixedRangeProfilesToStorage();
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
   * Obtiene el indicador de Order Flow
   */
  getFVGIndicator() {
    return this.fvgIndicator;
  }

  getVPPeriodicIndicator() {
    return this.vpPeriodicIndicator;
  }

  getResponseVolumeIndicator() {
    return this.responseVolumeIndicator;
  }

  getOrderFlowIndicator() {
    return this.orderFlowIndicator;
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
