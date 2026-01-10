import React, { useState, useEffect } from 'react';
import DTBProfilesManager from './DTBProfilesManager';

/**
 * Default configuration for Double Top/Bottom indicator
 */
function getDefaultConfig() {
  return {
    enabled: true,

    doubleTopBottom: {
      lookbackCandles: 100,
      candlesPerExtreme: 3,
      priceMarginPercent: 5.0,
      minCandlesBetween: 3,
      maxCandlesBetween: 80,

      rejectionPatterns: {
        requirePatterns: true,  // NUEVO: Checkbox maestro para validación de patrones
        hammer: true,
        shootingStar: true,
        bullishEngulfing: true,
        bearishEngulfing: true
      },

      volumeFilter: {
        enabled: false,
        zScoreThreshold: 1.5,
        zScorePeriod: 20
      },

      // High-volume extreme filter (reject extremes with low volume)
      requireHighVolumeAtExtremes: {
        enabled: false,
        zScoreThresholdFirst: 1.5,   // First extreme usually has higher volume (strong initial move)
        zScoreThresholdSecond: 0.5,  // Second extreme usually has lower volume (weakness/divergence)
        zScorePeriod: 20,            // Period for z-score calculation
        volumeWindowCandles: 3       // ⭐ NUEVO: Buscar volumen alto en ±N velas alrededor del extremo
      },

      maxBreakoutPercent: 2.0  // Maximum % price can exceed first extreme between peaks (breakout rejection)
    },

    momentumConfirmation: {
      enabled: false,

      patterns: {
        marubozu: {
          enabled: true,
          minBodyRatio: 0.8
        },
        soldiers_crows: {
          enabled: true,
          minBodyRatio: 0.6
        },
        bigBody: {
          enabled: true,
          minBodyRatio: 0.7,
          allowBigWick: true
        }
      },

      volumeFilter: {
        enabled: false,
        zScoreThreshold: 1.0,
        zScorePeriod: 20
      },

      lookbackAfterPattern: 10,
      requireMomentum: false
    },

    filters: {
      minConfidence: 20,
      requireBothRejections: false,
      minPatternDuration: 1,
      maxPatternDuration: 168,

      // Post-pattern validation (confirm directional movement)
      applyPostValidationToRealtimeSignals: false,  // Don't wait for confirmation on real-time signals
      postPatternValidationCandles: 5,
      minPostPatternMovePercent: 0.5,
      postPatternConfidenceBonus: 20,

      // Duplicate pattern filtering
      duplicatePriceTolerancePercent: 2.0,
      duplicateTimeToleranceHours: 24
    },

    visualization: {
      showLines: true,
      showRejectionIcons: true,
      showMomentumIcons: true,
      showEntryArrows: true,
      extendLineToRight: true,

      colors: {
        doubleTopLine: '#FF5722',
        doubleBottomLine: '#4CAF50',
        rejectionIcon: '#FFC107',
        entryLong: '#00E676',
        entryShort: '#FF1744'
      },

      lineStyle: {
        width: 2,
        dash: [10, 5]
      }
    },

    debugMode: false,
    alertsEnabled: false,  // Sistema de alertas automáticas

    // Sistema de alertas mejorado
    alertSettings: {
      // Modo de alerta
      mode: 'smart', // 'momentum_required' | 'pattern_complete' | 'smart'

      // Niveles de confianza con cooldowns personalizables
      confidenceLevels: {
        critical: {
          minConfidence: 80,
          cooldownSeconds: 60,
          color: '#F44336'
        },
        high: {
          minConfidence: 60,
          cooldownSeconds: 180,
          color: '#FF9800'
        },
        medium: {
          minConfidence: 40,
          cooldownSeconds: 300,
          color: '#FFC107'
        }
      },

      // Filtro VWAP Zone (detectar patrones en zonas extremas)
      vwapZoneFilter: {
        enabled: false,
        mode: 'oneExtreme',     // 'oneExtreme' = al menos uno, 'bothExtremes' = ambos deben cumplir
        minDeviation: 1,        // Desviación mínima requerida (1 = ±1σ, 2 = ±2σ, 3 = ±3σ)
        marginPercent: 0.5,     // Margen de tolerancia en % (el precio puede estar X% por debajo/encima de la banda)
        vwapType: 'session',    // Tipo de VWAP a usar: 'session', 'rolling', 'anchored'
        rollingPeriod: 20       // Período para VWAP rolling
      },

      // Visualización del círculo de detección
      visualization: {
        showDetectionCircle: true,
        detectionCircleColor: '#2196F3',
        detectionCircleSize: 8
      }
    }
  };
}

/**
 * Double Top/Bottom Settings Component
 *
 * Allows users to configure:
 * - Double top/bottom detection parameters
 * - Rejection pattern validation
 * - Volume filters
 * - Momentum confirmation (Phase 2)
 * - Visualization options
 */
const DoubleTopBottomSettings = ({
  symbol,
  currentTimeframe,
  onConfigChange,
  onClose,
  initialConfig,
  indicator
}) => {
  const [config, setConfig] = useState(initialConfig || getDefaultConfig());
  const [activeTab, setActiveTab] = useState('pattern');
  const logTimerRef = React.useRef(null);
  const saveLogTimerRef = React.useRef(null);
  const [testAlertStatus, setTestAlertStatus] = useState(null); // null | 'testing' | 'success' | 'error'

  // Estilos reutilizables
  const styles = {
    tabContent: { padding: '8px 0' },
    heading: { marginTop: 0, marginBottom: '16px', fontSize: '16px', color: '#333' },
    settingGroup: { marginBottom: '20px' },
    label: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: '500' },
    settingValue: { color: '#4CAF50', fontWeight: 'bold' },
    description: { fontSize: '12px', color: '#666', margin: '4px 0 0 0' },
    rangeInput: { width: '100%', cursor: 'pointer' },
    checkbox: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
    colorInput: { marginLeft: '8px', cursor: 'pointer' }
  };

  useEffect(() => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem(`double_topbottom_config_${symbol}`);
    if (savedConfig) {
      try {
        setConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error('Failed to load double top/bottom config:', e);
      }
    }

    // Cleanup: limpiar timers al desmontar
    return () => {
      if (logTimerRef.current) {
        clearTimeout(logTimerRef.current);
      }
      if (saveLogTimerRef.current) {
        clearTimeout(saveLogTimerRef.current);
      }
    };
  }, [symbol]);

  useEffect(() => {
    // Solo guardar en localStorage, NO notificar al parent
    // El parent solo se notificará cuando el usuario presione "Save & Close"
    localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(config));

    // Debounce del log (solo para logging)
    if (saveLogTimerRef.current) {
      clearTimeout(saveLogTimerRef.current);
    }

    saveLogTimerRef.current = setTimeout(() => {
      console.log(`[PRUEBA_DBT] Config saved to localStorage for ${symbol}`);
    }, 500);

    // Cleanup
    return () => {
      if (saveLogTimerRef.current) {
        clearTimeout(saveLogTimerRef.current);
      }
    };
  }, [config, symbol]);

  const handleSave = () => {
    console.log(`[PRUEBA_DBT] ${symbol} - User clicked Save & Close - will reload patterns`);

    // Cancelar timer pendiente
    if (saveLogTimerRef.current) {
      clearTimeout(saveLogTimerRef.current);
    }

    // Notificar al parent con la configuración final
    // Esto disparará la recarga de patrones desde el backend
    if (onConfigChange) {
      onConfigChange(config);
    }

    onClose();
  };

  const handleReset = () => {
    console.log(`[PRUEBA_DBT] ${symbol} - Resetting to default configuration`);
    const defaultConfig = getDefaultConfig();
    setConfig(defaultConfig);
    localStorage.removeItem(`double_topbottom_config_${symbol}`);
    console.log(`[PRUEBA_DBT] ${symbol} - Reset complete`, defaultConfig);
  };

  const handleTestAlert = async () => {
    if (!indicator) {
      console.error('No indicator reference available');
      setTestAlertStatus('error');
      setTimeout(() => setTestAlertStatus(null), 3000);
      return;
    }

    setTestAlertStatus('testing');
    console.log(`\n🧪 [${symbol}] User clicked Test Alert button`);

    try {
      const success = await indicator.sendTestAlert();
      setTestAlertStatus(success ? 'success' : 'error');

      // Reset status after 5 seconds
      setTimeout(() => setTestAlertStatus(null), 5000);
    } catch (error) {
      console.error('Test alert failed:', error);
      setTestAlertStatus('error');
      setTimeout(() => setTestAlertStatus(null), 3000);
    }
  };

  // Presets optimizados por timeframe (BASADOS EN SIMULACIONES)
  const applyTimeframePreset = (timeframe) => {
    const presets = {
      '1m': {
        lookbackCandles: 30,
        candlesPerExtreme: 2,
        priceMarginPercent: 10.0,  // Aumentado para micro movimientos
        minCandlesBetween: 1,       // Más permisivo
        maxCandlesBetween: 400,     // Aumentado para cubrir ~6.5 horas
        maxBreakoutPercent: 50,     // Muy permisivo para 1 minuto
        filters: {
          minConfidence: 70,
          minPatternDuration: 0.1,
          maxPatternDuration: 4,
          duplicatePriceTolerancePercent: 1.0,
          duplicateTimeToleranceHours: 1,
          requireBothRejections: false  // Más permisivo para 1m
        }
      },
      '5m': {
        lookbackCandles: 50,
        candlesPerExtreme: 3,
        priceMarginPercent: 6.0,
        minCandlesBetween: 2,
        maxCandlesBetween: 100,
        maxBreakoutPercent: 25,
        filters: {
          minConfidence: 65,
          minPatternDuration: 0.5,
          maxPatternDuration: 12,
          duplicatePriceTolerancePercent: 1.5,
          duplicateTimeToleranceHours: 3,
          requireBothRejections: false
        }
      },
      '15m': {
        lookbackCandles: 80,
        candlesPerExtreme: 4,
        priceMarginPercent: 4.0,
        minCandlesBetween: 3,
        maxCandlesBetween: 80,
        maxBreakoutPercent: 15,
        filters: {
          minConfidence: 70,
          minPatternDuration: 1,
          maxPatternDuration: 24,
          duplicatePriceTolerancePercent: 2.0,
          duplicateTimeToleranceHours: 6,
          requireBothRejections: false
        }
      },
      '60m': {
        lookbackCandles: 100,
        candlesPerExtreme: 5,
        priceMarginPercent: 3.0,
        minCandlesBetween: 3,
        maxCandlesBetween: 80,
        maxBreakoutPercent: 10,
        filters: {
          minConfidence: 75,
          minPatternDuration: 3,
          maxPatternDuration: 168,
          duplicatePriceTolerancePercent: 2.5,
          duplicateTimeToleranceHours: 24,
          requireBothRejections: true  // Más estricto para 1h
        }
      }
    };

    const preset = presets[timeframe];
    if (!preset) return;

    setConfig(prev => ({
      ...prev,
      doubleTopBottom: {
        ...prev.doubleTopBottom,
        lookbackCandles: preset.lookbackCandles,
        candlesPerExtreme: preset.candlesPerExtreme,
        priceMarginPercent: preset.priceMarginPercent,
        minCandlesBetween: preset.minCandlesBetween,
        maxCandlesBetween: preset.maxCandlesBetween,
        maxBreakoutPercent: preset.maxBreakoutPercent
      },
      filters: {
        ...prev.filters,  // Mantener valores existentes
        ...preset.filters  // Sobrescribir con valores del preset
      }
    }));

    console.log(`[PRUEBA_DBT] ${symbol} - Applied ${timeframe} preset`);
  };

  const updateConfig = (path, value) => {
    // Debounce logging: solo registra después de 500ms sin cambios
    if (logTimerRef.current) {
      clearTimeout(logTimerRef.current);
    }

    logTimerRef.current = setTimeout(() => {
      console.log(`[PRUEBA_DBT] Config change: ${path} = ${JSON.stringify(value)}`);
    }, 500);

    setConfig(prev => {
      const newConfig = { ...prev };
      const parts = path.split('.');
      let current = newConfig;

      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = { ...current[parts[i]] };
        current = current[parts[i]];
      }

      current[parts[parts.length - 1]] = value;
      return newConfig;
    });
  };

  // Handler para cuando se selecciona un perfil desde DTBProfilesManager
  const handleProfileSelect = (profileConfig) => {
    console.log(`[DTB] Profile selected for ${symbol}, applying configuration`, profileConfig);
    // Merge the profile config with the current config
    setConfig(prevConfig => ({
      ...prevConfig,
      ...profileConfig
    }));
  };

  const renderPatternTab = () => (
    <div style={styles.tabContent}>
      <h3 style={styles.heading}>
        Double Top/Bottom Detection
      </h3>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Lookback Candles</span>
          <span style={styles.settingValue}>{config.doubleTopBottom.lookbackCandles}</span>
        </label>
        <input
          type="range"
          min="10"
          max="200"
          value={config.doubleTopBottom.lookbackCandles}
          onChange={(e) => updateConfig('doubleTopBottom.lookbackCandles', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Number of candles to search for patterns (10-200)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Candles Per Extreme</span>
          <span style={styles.settingValue}>{config.doubleTopBottom.candlesPerExtreme}</span>
        </label>
        <input
          type="range"
          min="1"
          max="30"
          value={config.doubleTopBottom.candlesPerExtreme}
          onChange={(e) => updateConfig('doubleTopBottom.candlesPerExtreme', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Window size for detecting each extreme (1-30)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Price Margin %</span>
          <span style={styles.settingValue}>{config.doubleTopBottom.priceMarginPercent.toFixed(1)}%</span>
        </label>
        <input
          type="range"
          min="0.1"
          max="10.0"
          step="0.1"
          value={config.doubleTopBottom.priceMarginPercent}
          onChange={(e) => updateConfig('doubleTopBottom.priceMarginPercent', parseFloat(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Maximum price difference between tops/bottoms (0.1-10.0%)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Min Candles Between</span>
          <span style={styles.settingValue}>{config.doubleTopBottom.minCandlesBetween}</span>
        </label>
        <input
          type="range"
          min="1"
          max="50"
          value={config.doubleTopBottom.minCandlesBetween}
          onChange={(e) => updateConfig('doubleTopBottom.minCandlesBetween', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Minimum candles between extremes (1-50)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Max Candles Between</span>
          <span style={styles.settingValue}>{config.doubleTopBottom.maxCandlesBetween}</span>
        </label>
        <input
          type="range"
          min="10"
          max="500"
          value={config.doubleTopBottom.maxCandlesBetween}
          onChange={(e) => updateConfig('doubleTopBottom.maxCandlesBetween', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Maximum candles between extremes (10-500)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Max Breakout % 🚫</span>
          <span style={styles.settingValue}>{(config.doubleTopBottom.maxBreakoutPercent ?? 2.0).toFixed(1)}%</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="100.0"
          step="0.5"
          value={config.doubleTopBottom.maxBreakoutPercent ?? 2.0}
          onChange={(e) => updateConfig('doubleTopBottom.maxBreakoutPercent', parseFloat(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Maximum % price can break through first extreme between peaks (0.5-10.0%).
          Patterns with breakouts exceeding this are rejected as they indicate breakout continuation, not reversal.
        </p>
      </div>

      <h3>Rejection Patterns</h3>

      {/* Checkbox maestro para desactivar validación de patrones */}
      <div className="config-section" style={{ marginBottom: '15px', padding: '10px', border: '1px solid #555', borderRadius: '4px' }}>
        <label style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.rejectionPatterns.requirePatterns}
            onChange={(e) => updateConfig('doubleTopBottom.rejectionPatterns.requirePatterns', e.target.checked)}
          />
          <span style={{ marginLeft: '8px' }}>
            🔍 Require Rejection Pattern Validation
          </span>
        </label>
        <p className="hint" style={{ marginTop: '5px', marginLeft: '24px', opacity: 0.8 }}>
          When unchecked, patterns will be detected based only on price extremes without requiring specific candlestick patterns.
          This may detect more patterns but with potentially lower reliability.
        </p>
      </div>

      <div className="checkbox-group" style={{ opacity: config.doubleTopBottom.rejectionPatterns.requirePatterns ? 1 : 0.5 }}>
        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.rejectionPatterns.hammer}
            onChange={(e) => updateConfig('doubleTopBottom.rejectionPatterns.hammer', e.target.checked)}
            disabled={!config.doubleTopBottom.rejectionPatterns.requirePatterns}
          />
          <span>Hammer 🔨</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.rejectionPatterns.shootingStar}
            onChange={(e) => updateConfig('doubleTopBottom.rejectionPatterns.shootingStar', e.target.checked)}
            disabled={!config.doubleTopBottom.rejectionPatterns.requirePatterns}
          />
          <span>Shooting Star ⭐</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.rejectionPatterns.bullishEngulfing}
            onChange={(e) => updateConfig('doubleTopBottom.rejectionPatterns.bullishEngulfing', e.target.checked)}
            disabled={!config.doubleTopBottom.rejectionPatterns.requirePatterns}
          />
          <span>Bullish Engulfing 📈</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.rejectionPatterns.bearishEngulfing}
            onChange={(e) => updateConfig('doubleTopBottom.rejectionPatterns.bearishEngulfing', e.target.checked)}
            disabled={!config.doubleTopBottom.rejectionPatterns.requirePatterns}
          />
          <span>Bearish Engulfing 📉</span>
        </label>
      </div>
    </div>
  );

  const renderVolumeTab = () => (
    <div className="settings-tab-content">
      <h3>Volume Filter</h3>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.volumeFilter.enabled}
            onChange={(e) => updateConfig('doubleTopBottom.volumeFilter.enabled', e.target.checked)}
          />
          <span>Enable Volume Filter</span>
        </label>
      </div>

      {config.doubleTopBottom.volumeFilter.enabled && (
        <>
          <div className="setting-group">
            <label>
              <span>Z-Score Threshold</span>
              <span className="setting-value">{config.doubleTopBottom.volumeFilter.zScoreThreshold.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.1"
              value={config.doubleTopBottom.volumeFilter.zScoreThreshold}
              onChange={(e) => updateConfig('doubleTopBottom.volumeFilter.zScoreThreshold', parseFloat(e.target.value))}
            />
            <p className="setting-description">
              Minimum z-score for significant volume (1.0-3.0)
            </p>
          </div>

          <div className="setting-group">
            <label>
              <span>Z-Score Period</span>
              <span className="setting-value">{config.doubleTopBottom.volumeFilter.zScorePeriod}</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={config.doubleTopBottom.volumeFilter.zScorePeriod}
              onChange={(e) => updateConfig('doubleTopBottom.volumeFilter.zScorePeriod', parseInt(e.target.value))}
            />
            <p className="setting-description">
              Period for z-score calculation (10-100)
            </p>
          </div>
        </>
      )}

      <h3 style={{marginTop: '30px'}}>High-Volume Extreme Filter</h3>
      <p style={{fontSize: '12px', color: '#888', marginBottom: '15px'}}>
        ⚠️ Reject extremes (highs/lows) with low volume. Ensures big players are involved at key levels.
      </p>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.doubleTopBottom.requireHighVolumeAtExtremes?.enabled || false}
            onChange={(e) => updateConfig('doubleTopBottom.requireHighVolumeAtExtremes.enabled', e.target.checked)}
          />
          <span>Require High Volume at Extremes</span>
        </label>
      </div>

      {config.doubleTopBottom.requireHighVolumeAtExtremes?.enabled && (
        <>
          <div className="setting-group">
            <label>
              <span>Z-Score Threshold (First Extreme) 🔥</span>
              <span className="setting-value">{(config.doubleTopBottom.requireHighVolumeAtExtremes?.zScoreThresholdFirst || 1.5).toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={config.doubleTopBottom.requireHighVolumeAtExtremes?.zScoreThresholdFirst || 1.5}
              onChange={(e) => updateConfig('doubleTopBottom.requireHighVolumeAtExtremes.zScoreThresholdFirst', parseFloat(e.target.value))}
            />
            <p className="setting-description">
              Minimum z-score for volume at FIRST extreme (0.5-3.0). Usually higher volume (strong initial move).
            </p>
          </div>

          <div className="setting-group">
            <label>
              <span>Z-Score Threshold (Second Extreme) 📉</span>
              <span className="setting-value">{(config.doubleTopBottom.requireHighVolumeAtExtremes?.zScoreThresholdSecond || 0.5).toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.0"
              max="3.0"
              step="0.1"
              value={config.doubleTopBottom.requireHighVolumeAtExtremes?.zScoreThresholdSecond || 0.5}
              onChange={(e) => updateConfig('doubleTopBottom.requireHighVolumeAtExtremes.zScoreThresholdSecond', parseFloat(e.target.value))}
            />
            <p className="setting-description">
              Minimum z-score for volume at SECOND extreme (0.0-3.0). Usually lower volume (weakness/divergence).
            </p>
          </div>

          <div className="setting-group">
            <label>
              <span>Z-Score Period</span>
              <span className="setting-value">{config.doubleTopBottom.requireHighVolumeAtExtremes?.zScorePeriod || 20}</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={config.doubleTopBottom.requireHighVolumeAtExtremes?.zScorePeriod || 20}
              onChange={(e) => updateConfig('doubleTopBottom.requireHighVolumeAtExtremes.zScorePeriod', parseInt(e.target.value))}
            />
            <p className="setting-description">
              Period for z-score calculation (10-100 candles)
            </p>
          </div>

          <div className="setting-group">
            <label>
              <span>Volume Window (candles) 🔍</span>
              <span className="setting-value">±{config.doubleTopBottom.requireHighVolumeAtExtremes?.volumeWindowCandles || 3}</span>
            </label>
            <input
              type="range"
              min="0"
              max="10"
              value={config.doubleTopBottom.requireHighVolumeAtExtremes?.volumeWindowCandles || 3}
              onChange={(e) => updateConfig('doubleTopBottom.requireHighVolumeAtExtremes.volumeWindowCandles', parseInt(e.target.value))}
            />
            <p className="setting-description">
              Buscar volumen alto en ±N velas alrededor del extremo (0-10).
              0 = solo vela del extremo (estricto), 3 = ±3 velas (recomendado), 5+ = permisivo.
              Permite capturar volumen en velas adyacentes (acumulación/confirmación).
            </p>
          </div>
        </>
      )}
    </div>
  );

  const renderMomentumTab = () => (
    <div className="settings-tab-content">
      <h3>Momentum Confirmation</h3>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.momentumConfirmation.enabled}
            onChange={(e) => updateConfig('momentumConfirmation.enabled', e.target.checked)}
          />
          <span>Enable Momentum Confirmation</span>
        </label>
      </div>

      {config.momentumConfirmation.enabled && (
        <>
          <div className="setting-group">
            <label>
              <span>Lookback After Pattern</span>
              <span className="setting-value">{config.momentumConfirmation.lookbackAfterPattern}</span>
            </label>
            <input
              type="range"
              min="3"
              max="20"
              value={config.momentumConfirmation.lookbackAfterPattern}
              onChange={(e) => updateConfig('momentumConfirmation.lookbackAfterPattern', parseInt(e.target.value))}
            />
            <p className="setting-description">
              Candles to search for momentum after pattern
            </p>
          </div>

          <h4>Momentum Patterns</h4>

          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.momentumConfirmation.patterns.marubozu.enabled}
                onChange={(e) => updateConfig('momentumConfirmation.patterns.marubozu.enabled', e.target.checked)}
              />
              <span>Marubozu 🚀</span>
            </label>

            {config.momentumConfirmation.patterns.marubozu.enabled && (
              <div className="setting-group-nested">
                <label>
                  <span>Min Body Ratio</span>
                  <span className="setting-value">{(config.momentumConfirmation.patterns.marubozu.minBodyRatio * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min="0.7"
                  max="0.95"
                  step="0.05"
                  value={config.momentumConfirmation.patterns.marubozu.minBodyRatio}
                  onChange={(e) => updateConfig('momentumConfirmation.patterns.marubozu.minBodyRatio', parseFloat(e.target.value))}
                />
              </div>
            )}
          </div>

          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.momentumConfirmation.patterns.soldiers_crows.enabled}
                onChange={(e) => updateConfig('momentumConfirmation.patterns.soldiers_crows.enabled', e.target.checked)}
              />
              <span>Soldiers/Crows 🔥</span>
            </label>

            {config.momentumConfirmation.patterns.soldiers_crows.enabled && (
              <div className="setting-group-nested">
                <label>
                  <span>Min Body Ratio</span>
                  <span className="setting-value">{(config.momentumConfirmation.patterns.soldiers_crows.minBodyRatio * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="0.8"
                  step="0.05"
                  value={config.momentumConfirmation.patterns.soldiers_crows.minBodyRatio}
                  onChange={(e) => updateConfig('momentumConfirmation.patterns.soldiers_crows.minBodyRatio', parseFloat(e.target.value))}
                />
              </div>
            )}
          </div>

          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.momentumConfirmation.patterns.bigBody.enabled}
                onChange={(e) => updateConfig('momentumConfirmation.patterns.bigBody.enabled', e.target.checked)}
              />
              <span>Big Body 💥</span>
            </label>

            {config.momentumConfirmation.patterns.bigBody.enabled && (
              <>
                <div className="setting-group-nested">
                  <label>
                    <span>Min Body Ratio</span>
                    <span className="setting-value">{(config.momentumConfirmation.patterns.bigBody.minBodyRatio * 100).toFixed(0)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0.6"
                    max="0.85"
                    step="0.05"
                    value={config.momentumConfirmation.patterns.bigBody.minBodyRatio}
                    onChange={(e) => updateConfig('momentumConfirmation.patterns.bigBody.minBodyRatio', parseFloat(e.target.value))}
                  />
                </div>

                <div className="checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={config.momentumConfirmation.patterns.bigBody.allowBigWick}
                      onChange={(e) => updateConfig('momentumConfirmation.patterns.bigBody.allowBigWick', e.target.checked)}
                    />
                    <span>Allow Big Wick</span>
                  </label>
                </div>
              </>
            )}
          </div>

          <h4 style={{marginTop: '30px'}}>Volume Filter 📊</h4>
          <p style={{fontSize: '12px', color: '#888', marginBottom: '15px'}}>
            Validates that momentum patterns have institutional backing (high volume).
          </p>

          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.momentumConfirmation.volumeFilter?.enabled || false}
                onChange={(e) => updateConfig('momentumConfirmation.volumeFilter.enabled', e.target.checked)}
              />
              <span>Require High Volume in Momentum</span>
            </label>
          </div>

          {config.momentumConfirmation.volumeFilter?.enabled && (
            <>
              <div className="setting-group">
                <label>
                  <span>Z-Score Threshold</span>
                  <span className="setting-value">{(config.momentumConfirmation.volumeFilter?.zScoreThreshold || 1.0).toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={config.momentumConfirmation.volumeFilter?.zScoreThreshold || 1.0}
                  onChange={(e) => updateConfig('momentumConfirmation.volumeFilter.zScoreThreshold', parseFloat(e.target.value))}
                />
                <p className="setting-description">
                  Minimum z-score for volume in momentum candles (0.5-3.0). For multi-candle patterns (Soldiers/Crows), average z-score is used.
                </p>
              </div>

              <div className="setting-group">
                <label>
                  <span>Z-Score Period</span>
                  <span className="setting-value">{config.momentumConfirmation.volumeFilter?.zScorePeriod || 20}</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={config.momentumConfirmation.volumeFilter?.zScorePeriod || 20}
                  onChange={(e) => updateConfig('momentumConfirmation.volumeFilter.zScorePeriod', parseInt(e.target.value))}
                />
                <p className="setting-description">
                  Period for z-score calculation (10-100 candles)
                </p>
              </div>
            </>
          )}

          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.momentumConfirmation.requireMomentum}
                onChange={(e) => updateConfig('momentumConfirmation.requireMomentum', e.target.checked)}
              />
              <span>Require Momentum for Signal</span>
            </label>
          </div>
        </>
      )}
    </div>
  );

  const renderFiltersTab = () => (
    <div className="settings-tab-content">
      <h3>Filters</h3>

      <div className="setting-group">
        <label>
          <span>Min Confidence</span>
          <span className="setting-value">{config.filters.minConfidence}</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={config.filters.minConfidence}
          onChange={(e) => updateConfig('filters.minConfidence', parseInt(e.target.value))}
        />
        <p className="setting-description">
          Minimum confidence score (0-100)
        </p>
      </div>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.filters.requireBothRejections}
            onChange={(e) => updateConfig('filters.requireBothRejections', e.target.checked)}
          />
          <span>Require Rejection at Both Extremes</span>
        </label>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Min Pattern Duration (hours)</span>
          <span style={styles.settingValue}>{config.filters.minPatternDuration}</span>
        </label>
        <input
          type="range"
          min="0"
          max="48"
          value={config.filters.minPatternDuration}
          onChange={(e) => updateConfig('filters.minPatternDuration', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Minimum pattern duration (0-48 hours)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Max Pattern Duration (hours)</span>
          <span style={styles.settingValue}>{config.filters.maxPatternDuration}</span>
        </label>
        <input
          type="range"
          min="24"
          max="336"
          value={config.filters.maxPatternDuration}
          onChange={(e) => updateConfig('filters.maxPatternDuration', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Maximum pattern duration (24-336 hours / 2 weeks)
        </p>
      </div>

      <h4 style={{marginTop: '20px', marginBottom: '10px'}}>Post-Pattern Validation</h4>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.filters.applyPostValidationToRealtimeSignals || false}
            onChange={(e) => updateConfig('filters.applyPostValidationToRealtimeSignals', e.target.checked)}
          />
          <span>Apply to Real-Time Signals</span>
        </label>
        <p style={{...styles.description, marginTop: '5px', marginLeft: '0px'}}>
          ⚠️ If OFF (recommended for trading): Real-time signals appear immediately without waiting for price confirmation.
          Historical patterns still get validated for accuracy. If ON: All patterns must confirm directional movement before appearing (better for backtesting).
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Validation Candles</span>
          <span style={styles.settingValue}>{config.filters.postPatternValidationCandles || 5}</span>
        </label>
        <input
          type="range"
          min="3"
          max="10"
          value={config.filters.postPatternValidationCandles || 5}
          onChange={(e) => updateConfig('filters.postPatternValidationCandles', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Number of candles to check after pattern for directional movement (3-10)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Min Post-Pattern Move (%)</span>
          <span style={styles.settingValue}>{(config.filters.minPostPatternMovePercent || 0.5).toFixed(1)}</span>
        </label>
        <input
          type="range"
          min="0.1"
          max="5.0"
          step="0.1"
          value={config.filters.minPostPatternMovePercent || 0.5}
          onChange={(e) => updateConfig('filters.minPostPatternMovePercent', parseFloat(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Minimum price movement (%) after pattern to confirm rejection (0.1-5.0%)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Confidence Bonus</span>
          <span style={styles.settingValue}>{config.filters.postPatternConfidenceBonus || 20}</span>
        </label>
        <input
          type="range"
          min="0"
          max="50"
          value={config.filters.postPatternConfidenceBonus || 20}
          onChange={(e) => updateConfig('filters.postPatternConfidenceBonus', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Confidence bonus added when directional movement is confirmed (0-50 points)
        </p>
      </div>

      <h4 style={{marginTop: '20px', marginBottom: '10px'}}>Duplicate Filtering</h4>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Price Tolerance (%)</span>
          <span style={styles.settingValue}>{(config.filters.duplicatePriceTolerancePercent || 2.0).toFixed(1)}</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="10.0"
          step="0.5"
          value={config.filters.duplicatePriceTolerancePercent || 2.0}
          onChange={(e) => updateConfig('filters.duplicatePriceTolerancePercent', parseFloat(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Price tolerance for considering patterns as duplicates (0.5-10.0%)
        </p>
      </div>

      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Time Tolerance (hours)</span>
          <span style={styles.settingValue}>{config.filters.duplicateTimeToleranceHours || 24}</span>
        </label>
        <input
          type="range"
          min="6"
          max="72"
          value={config.filters.duplicateTimeToleranceHours || 24}
          onChange={(e) => updateConfig('filters.duplicateTimeToleranceHours', parseInt(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={styles.description}>
          Time tolerance for considering patterns as duplicates (6-72 hours)
        </p>
      </div>
    </div>
  );

  const renderVisualizationTab = () => (
    <div className="settings-tab-content">
      <h3>Visualization</h3>

      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={config.visualization.showLines}
            onChange={(e) => updateConfig('visualization.showLines', e.target.checked)}
          />
          <span>Show Level Lines</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.visualization.showRejectionIcons}
            onChange={(e) => updateConfig('visualization.showRejectionIcons', e.target.checked)}
          />
          <span>Show Rejection Icons</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.visualization.showMomentumIcons}
            onChange={(e) => updateConfig('visualization.showMomentumIcons', e.target.checked)}
          />
          <span>Show Momentum Icons</span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={config.visualization.showEntryArrows}
            onChange={(e) => updateConfig('visualization.showEntryArrows', e.target.checked)}
          />
          <span>Show Entry Arrows</span>
        </label>
      </div>

      <h4>Colors</h4>

      <div className="color-setting-group">
        <label>
          <span>Double Top Line</span>
          <input
            type="color"
            value={config.visualization.colors.doubleTopLine}
            onChange={(e) => updateConfig('visualization.colors.doubleTopLine', e.target.value)}
          />
        </label>

        <label>
          <span>Double Bottom Line</span>
          <input
            type="color"
            value={config.visualization.colors.doubleBottomLine}
            onChange={(e) => updateConfig('visualization.colors.doubleBottomLine', e.target.value)}
          />
        </label>

        <label>
          <span>Entry Long</span>
          <input
            type="color"
            value={config.visualization.colors.entryLong}
            onChange={(e) => updateConfig('visualization.colors.entryLong', e.target.value)}
          />
        </label>

        <label>
          <span>Entry Short</span>
          <input
            type="color"
            value={config.visualization.colors.entryShort}
            onChange={(e) => updateConfig('visualization.colors.entryShort', e.target.value)}
          />
        </label>
      </div>

      <h4>Line Style</h4>

      <div className="setting-group">
        <label>
          <span>Line Width</span>
          <span className="setting-value">{config.visualization.lineStyle.width}</span>
        </label>
        <input
          type="range"
          min="1"
          max="5"
          value={config.visualization.lineStyle.width}
          onChange={(e) => updateConfig('visualization.lineStyle.width', parseInt(e.target.value))}
        />
      </div>
    </div>
  );

  const renderRealTimeTab = () => (
    <div style={styles.tabContent}>
      <h3 style={styles.heading}>⚡ Real-time Detection</h3>

      <div style={styles.settingGroup}>
        <label style={styles.checkbox}>
          <input
            type="checkbox"
            checked={config.realTimeDetection?.enabled || false}
            onChange={(e) => updateConfig('realTimeDetection.enabled', e.target.checked)}
          />
          <span style={{ fontWeight: 'bold' }}>Enable Real-time Pattern Detection</span>
        </label>
        <p style={styles.description}>
          When enabled, the indicator will automatically detect new Double Top/Bottom patterns
          as candles close via WebSocket. Alerts will be sent immediately when patterns are found.
        </p>
      </div>

      {config.realTimeDetection?.enabled && (
        <>
          <div style={styles.settingGroup}>
            <label style={styles.label}>
              <span>Lookback Candles (Analysis Window)</span>
              <span style={styles.settingValue}>{config.realTimeDetection?.lookbackCandles || 100}</span>
            </label>
            <input
              type="range"
              min="50"
              max="500"
              step="10"
              value={config.realTimeDetection?.lookbackCandles || 100}
              onChange={(e) => updateConfig('realTimeDetection.lookbackCandles', parseInt(e.target.value))}
              style={styles.rangeInput}
            />
            <p style={styles.description}>
              Number of recent candles to analyze when detecting patterns in real-time (50-500).
              Lower values = faster performance, Higher values = more historical context.
              <br />
              <strong>Recommended:</strong> 100-200 candles for most timeframes
            </p>
          </div>

          <div style={styles.settingGroup}>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={config.realTimeDetection?.debugMode || false}
                onChange={(e) => updateConfig('realTimeDetection.debugMode', e.target.checked)}
              />
              <span>Debug Mode (Console Logs)</span>
            </label>
            <p style={styles.description}>
              Enable detailed console logging for real-time detection. Useful for troubleshooting
              but may impact performance. Check browser console (F12) to see logs.
            </p>
          </div>

          <div style={{
            marginTop: '20px',
            padding: '12px',
            background: '#e3f2fd',
            borderRadius: '4px',
            border: '1px solid #90caf9'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#1976d2' }}>
              ℹ️ How Real-time Detection Works
            </div>
            <ul style={{ fontSize: '12px', color: '#555', margin: '0', paddingLeft: '20px' }}>
              <li>Monitors WebSocket for candle close events</li>
              <li>Analyzes only the last {config.realTimeDetection?.lookbackCandles || 100} candles for performance</li>
              <li>Throttles detection to prevent excessive API calls (90% of interval duration)</li>
              <li>Prevents duplicate alerts by tracking previously detected patterns</li>
              <li>Sends alerts automatically if "Enable Automatic Alerts" is enabled below</li>
            </ul>
          </div>

          <div style={{
            marginTop: '12px',
            padding: '12px',
            background: '#fff3e0',
            borderRadius: '4px',
            border: '1px solid #ffb74d'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#f57c00' }}>
              ⚠️ Performance Considerations
            </div>
            <ul style={{ fontSize: '12px', color: '#555', margin: '0', paddingLeft: '20px' }}>
              <li><strong>Lookback 50-100:</strong> Best for 1m-5m timeframes (fast detection)</li>
              <li><strong>Lookback 100-200:</strong> Best for 15m-1h timeframes (balanced)</li>
              <li><strong>Lookback 200-500:</strong> Best for 4h+ timeframes (maximum context)</li>
              <li>Higher values may cause lag on candle close, especially with multiple symbols</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );

  const renderAlertsTab = () => (
    <div style={styles.tabContent}>
      <h3 style={styles.heading}>🔔 Alert System Configuration</h3>

      {/* Alert Mode */}
      <div style={styles.settingGroup}>
        <label style={styles.label}>
          <span>Alert Mode</span>
        </label>
        <select
          value={config.alertSettings?.mode || 'smart'}
          onChange={(e) => updateConfig('alertSettings.mode', e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '4px',
            border: '1px solid #ddd',
            fontSize: '13px'
          }}
        >
          <option value="momentum_required">🎯 Momentum Required - Only send alerts with momentum confirmation</option>
          <option value="pattern_complete">⚡ Pattern Complete - Send immediately when pattern is detected</option>
          <option value="smart">🧠 Smart Mode - Flexible based on confidence and context (RECOMMENDED)</option>
        </select>
        <p style={styles.description}>
          {config.alertSettings?.mode === 'momentum_required' &&
            "Alerts only sent when momentum is confirmed. Most conservative mode."}
          {config.alertSettings?.mode === 'pattern_complete' &&
            "Alerts sent immediately when both extremes are detected. Fastest mode."}
          {config.alertSettings?.mode === 'smart' &&
            "Intelligently decides based on confidence levels and momentum presence. Balanced mode."}
        </p>
      </div>

      {/* Confidence Levels */}
      <div style={styles.settingGroup}>
        <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: '#555' }}>
          Confidence Levels & Cooldowns
        </h4>

        {/* Critical Level */}
        <div style={{ marginBottom: '16px', padding: '12px', background: '#ffebee', borderRadius: '4px' }}>
          <label style={styles.label}>
            <span>🔴 Critical Alert (min confidence %)</span>
            <span style={{ color: '#F44336', fontWeight: 'bold' }}>
              {config.alertSettings?.confidenceLevels?.critical?.minConfidence || 80}%
            </span>
          </label>
          <input
            type="range"
            min="60"
            max="100"
            step="1"
            value={config.alertSettings?.confidenceLevels?.critical?.minConfidence || 80}
            onChange={(e) => updateConfig('alertSettings.confidenceLevels.critical.minConfidence', parseFloat(e.target.value))}
            style={styles.rangeInput}
          />
          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '12px', color: '#666' }}>
              <span>Cooldown (seconds):</span>
              <input
                type="number"
                min="30"
                max="600"
                value={config.alertSettings?.confidenceLevels?.critical?.cooldownSeconds || 60}
                onChange={(e) => updateConfig('alertSettings.confidenceLevels.critical.cooldownSeconds', parseInt(e.target.value))}
                style={{
                  width: '80px',
                  padding: '4px',
                  marginLeft: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              />
            </label>
          </div>
        </div>

        {/* High Level */}
        <div style={{ marginBottom: '16px', padding: '12px', background: '#fff3e0', borderRadius: '4px' }}>
          <label style={styles.label}>
            <span>🟠 High Alert (min confidence %)</span>
            <span style={{ color: '#FF9800', fontWeight: 'bold' }}>
              {config.alertSettings?.confidenceLevels?.high?.minConfidence || 60}%
            </span>
          </label>
          <input
            type="range"
            min="40"
            max="90"
            step="1"
            value={config.alertSettings?.confidenceLevels?.high?.minConfidence || 60}
            onChange={(e) => updateConfig('alertSettings.confidenceLevels.high.minConfidence', parseFloat(e.target.value))}
            style={styles.rangeInput}
          />
          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '12px', color: '#666' }}>
              <span>Cooldown (seconds):</span>
              <input
                type="number"
                min="60"
                max="600"
                value={config.alertSettings?.confidenceLevels?.high?.cooldownSeconds || 180}
                onChange={(e) => updateConfig('alertSettings.confidenceLevels.high.cooldownSeconds', parseInt(e.target.value))}
                style={{
                  width: '80px',
                  padding: '4px',
                  marginLeft: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              />
            </label>
          </div>
        </div>

        {/* Medium Level */}
        <div style={{ marginBottom: '16px', padding: '12px', background: '#fffde7', borderRadius: '4px' }}>
          <label style={styles.label}>
            <span>🟡 Medium Alert (min confidence %)</span>
            <span style={{ color: '#FFC107', fontWeight: 'bold' }}>
              {config.alertSettings?.confidenceLevels?.medium?.minConfidence || 40}%
            </span>
          </label>
          <input
            type="range"
            min="20"
            max="70"
            step="1"
            value={config.alertSettings?.confidenceLevels?.medium?.minConfidence || 40}
            onChange={(e) => updateConfig('alertSettings.confidenceLevels.medium.minConfidence', parseFloat(e.target.value))}
            style={styles.rangeInput}
          />
          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '12px', color: '#666' }}>
              <span>Cooldown (seconds):</span>
              <input
                type="number"
                min="120"
                max="900"
                value={config.alertSettings?.confidenceLevels?.medium?.cooldownSeconds || 300}
                onChange={(e) => updateConfig('alertSettings.confidenceLevels.medium.cooldownSeconds', parseInt(e.target.value))}
                style={{
                  width: '80px',
                  padding: '4px',
                  marginLeft: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* VWAP Zone Filter */}
      <div style={styles.settingGroup}>
        <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: '#555' }}>
          📊 VWAP Zone Filter (Filtro por Zonas Extremas)
        </h4>
        <label style={styles.checkbox}>
          <input
            type="checkbox"
            checked={config.alertSettings?.vwapZoneFilter?.enabled || false}
            onChange={(e) => updateConfig('alertSettings.vwapZoneFilter.enabled', e.target.checked)}
          />
          <span>Activar filtro VWAP Zone</span>
        </label>
        <p style={styles.description}>
          Filtra patrones por ubicación respecto a bandas VWAP:
          <br />• <strong>Double Top</strong>: extremo(s) deben estar <strong>ARRIBA</strong> de desviación positiva (+σ)
          <br />• <strong>Double Bottom</strong>: extremo(s) deben estar <strong>ABAJO</strong> de desviación negativa (-σ)
          <br />⚠️ Este filtro <strong>descarta</strong> patrones que no cumplan (no solo alertas)
        </p>

        {config.alertSettings?.vwapZoneFilter?.enabled && (
          <div style={{ marginTop: '12px', padding: '12px', background: '#e3f2fd', borderRadius: '4px' }}>

            {/* Modo: uno o ambos extremos */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ ...styles.label, marginBottom: '4px' }}>
                <span>Condición de extremos</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ ...styles.checkbox, marginBottom: 0 }}>
                  <input
                    type="radio"
                    name="vwapMode"
                    checked={config.alertSettings?.vwapZoneFilter?.mode === 'oneExtreme'}
                    onChange={() => updateConfig('alertSettings.vwapZoneFilter.mode', 'oneExtreme')}
                  />
                  <span>Al menos un extremo</span>
                </label>
                <label style={{ ...styles.checkbox, marginBottom: 0 }}>
                  <input
                    type="radio"
                    name="vwapMode"
                    checked={config.alertSettings?.vwapZoneFilter?.mode === 'bothExtremes'}
                    onChange={() => updateConfig('alertSettings.vwapZoneFilter.mode', 'bothExtremes')}
                  />
                  <span>Ambos extremos</span>
                </label>
              </div>
              <p style={{ ...styles.description, marginTop: '4px' }}>
                {config.alertSettings?.vwapZoneFilter?.mode === 'bothExtremes'
                  ? '⚡ Estricto: ambos extremos deben estar en zona extrema'
                  : '✓ Flexible: basta con que uno esté en zona extrema'}
              </p>
            </div>

            {/* Desviación mínima */}
            <label style={styles.label}>
              <span>Desviación mínima requerida</span>
              <span style={styles.settingValue}>
                ±{config.alertSettings?.vwapZoneFilter?.minDeviation || 1}σ
              </span>
            </label>
            <input
              type="range"
              min="1"
              max="3"
              step="1"
              value={config.alertSettings?.vwapZoneFilter?.minDeviation || 1}
              onChange={(e) => updateConfig('alertSettings.vwapZoneFilter.minDeviation', parseInt(e.target.value))}
              style={styles.rangeInput}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '12px' }}>
              <span>±1σ (menos estricto)</span>
              <span>±2σ</span>
              <span>±3σ (más estricto)</span>
            </div>

            {/* Margen de tolerancia */}
            <label style={styles.label}>
              <span>Margen de tolerancia (%)</span>
              <span style={styles.settingValue}>
                {config.alertSettings?.vwapZoneFilter?.marginPercent || 0.5}%
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={config.alertSettings?.vwapZoneFilter?.marginPercent || 0.5}
              onChange={(e) => updateConfig('alertSettings.vwapZoneFilter.marginPercent', parseFloat(e.target.value))}
              style={styles.rangeInput}
            />
            <p style={styles.description}>
              Permite que el precio esté hasta un {config.alertSettings?.vwapZoneFilter?.marginPercent || 0.5}% por debajo (DT) o arriba (DB) de la banda.
            </p>

            {/* Tipo de VWAP */}
            <div style={{ marginTop: '16px' }}>
              <label style={{ ...styles.label, marginBottom: '4px' }}>
                <span>Tipo de VWAP</span>
              </label>
              <select
                value={config.alertSettings?.vwapZoneFilter?.vwapType || 'session'}
                onChange={(e) => updateConfig('alertSettings.vwapZoneFilter.vwapType', e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="session">Session (reset diario)</option>
                <option value="rolling">Rolling (período móvil)</option>
              </select>
            </div>

            {config.alertSettings?.vwapZoneFilter?.vwapType === 'rolling' && (
              <div style={{ marginTop: '12px' }}>
                <label style={styles.label}>
                  <span>Período rolling</span>
                  <span style={styles.settingValue}>
                    {config.alertSettings?.vwapZoneFilter?.rollingPeriod || 20} velas
                  </span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={config.alertSettings?.vwapZoneFilter?.rollingPeriod || 20}
                  onChange={(e) => updateConfig('alertSettings.vwapZoneFilter.rollingPeriod', parseInt(e.target.value))}
                  style={styles.rangeInput}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detection Circle Visualization */}
      <div style={styles.settingGroup}>
        <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: '#555' }}>
          🔵 Detection Circle
        </h4>
        <label style={styles.checkbox}>
          <input
            type="checkbox"
            checked={config.alertSettings?.visualization?.showDetectionCircle !== false}
            onChange={(e) => updateConfig('alertSettings.visualization.showDetectionCircle', e.target.checked)}
          />
          <span>Show detection circle on chart</span>
        </label>
        <p style={styles.description}>
          Displays a blue circle on the candle where the pattern was detected/confirmed.
        </p>

        {config.alertSettings?.visualization?.showDetectionCircle !== false && (
          <div style={{ marginTop: '12px', padding: '12px', background: '#e8eaf6', borderRadius: '4px' }}>
            <label style={styles.label}>
              <span>Circle size (pixels)</span>
              <span style={styles.settingValue}>
                {config.alertSettings?.visualization?.detectionCircleSize || 8}px
              </span>
            </label>
            <input
              type="range"
              min="4"
              max="16"
              step="1"
              value={config.alertSettings?.visualization?.detectionCircleSize || 8}
              onChange={(e) => updateConfig('alertSettings.visualization.detectionCircleSize', parseInt(e.target.value))}
              style={styles.rangeInput}
            />

            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center' }}>
                <span>Circle color:</span>
                <input
                  type="color"
                  value={config.alertSettings?.visualization?.detectionCircleColor || '#2196F3'}
                  onChange={(e) => updateConfig('alertSettings.visualization.detectionCircleColor', e.target.value)}
                  style={styles.colorInput}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '0' }}>
      {/* DTB Profiles Manager - Sistema de perfiles optimizados */}
      <DTBProfilesManager
        currentConfig={config}
        onProfileSelect={handleProfileSelect}
        currentTimeframe={currentTimeframe}
        symbol={symbol}
      />

      {/* Quick Presets Section (Deprecated - kept for backward compatibility) */}
      <div style={{
        background: '#f8f9fa',
        padding: '12px',
        borderRadius: '6px',
        marginBottom: '16px',
        border: '1px solid #dee2e6',
        display: 'none' // Hidden as we're using DTBProfilesManager now
      }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#495057' }}>
          ⚡ Quick Presets (Timeframe Optimized)
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => applyTimeframePreset('1m')}
            style={{
              padding: '8px 16px',
              background: '#FF6B6B',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            1 Minute
          </button>
          <button
            onClick={() => applyTimeframePreset('5m')}
            style={{
              padding: '8px 16px',
              background: '#4ECDC4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            5 Minutes
          </button>
          <button
            onClick={() => applyTimeframePreset('15m')}
            style={{
              padding: '8px 16px',
              background: '#6C5CE7',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            15 Minutes
          </button>
          <button
            onClick={() => applyTimeframePreset('60m')}
            style={{
              padding: '8px 16px',
              background: '#95E1D3',
              color: '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            1 Hour
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '8px' }}>
          Click a preset to automatically adjust all parameters for optimal detection in that timeframe
        </div>
      </div>

      <div style={{
        borderBottom: '1px solid #ddd',
        marginBottom: '16px',
        paddingBottom: '12px'
      }}>
        <div style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap'
        }}>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'pattern' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'pattern' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('pattern')}
          >
            Pattern
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'volume' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'volume' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('volume')}
          >
            Volume
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'momentum' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'momentum' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('momentum')}
          >
            Momentum
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'filters' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'filters' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('filters')}
          >
            Filters
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'visualization' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'visualization' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('visualization')}
          >
            Visualization
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'realtime' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'realtime' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('realtime')}
          >
            ⚡ Real-time
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: activeTab === 'alerts' ? '#4CAF50' : '#f0f0f0',
              color: activeTab === 'alerts' ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
            onClick={() => setActiveTab('alerts')}
          >
            🔔 Alerts
          </button>
        </div>
      </div>

      <div style={{
        maxHeight: '500px',
        overflowY: 'auto',
        padding: '0 4px'
      }}>
        {activeTab === 'pattern' && renderPatternTab()}
        {activeTab === 'volume' && renderVolumeTab()}
        {activeTab === 'momentum' && renderMomentumTab()}
        {activeTab === 'filters' && renderFiltersTab()}
        {activeTab === 'visualization' && renderVisualizationTab()}
        {activeTab === 'realtime' && renderRealTimeTab()}
        {activeTab === 'alerts' && renderAlertsTab()}
      </div>

      <div style={{
        marginTop: '16px',
        paddingTop: '12px',
        borderTop: '1px solid #ddd',
        display: 'flex',
        gap: '8px',
        justifyContent: 'space-between'
      }}>
        <button
          style={{
            padding: '8px 16px',
            background: '#FF9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '500'
          }}
          onClick={handleReset}
          title="Reset to default (more permissive) values"
        >
          Reset to Defaults
        </button>

        {/* Sistema de Alertas */}
        <div style={{
          marginTop: '16px',
          padding: '16px',
          background: config.alertsEnabled ? '#e8f5e9' : '#fff3e0',
          border: `2px solid ${config.alertsEnabled ? '#4CAF50' : '#FF9800'}`,
          borderRadius: '8px'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            color: config.alertsEnabled ? '#2E7D32' : '#F57C00'
          }}>
            <input
              type="checkbox"
              checked={config.alertsEnabled || false}
              onChange={(e) => updateConfig('alertsEnabled', e.target.checked)}
              style={{ marginRight: '8px', cursor: 'pointer', width: '18px', height: '18px' }}
            />
            🔔 Habilitar Alertas Automáticas
          </label>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '8px', marginLeft: '26px' }}>
            {config.alertsEnabled ? (
              <span>
                ✅ <strong>Alertas ACTIVAS:</strong> Recibirás notificaciones cuando se detecten nuevos patrones Double Top/Bottom con señal de entrada confirmada.
                <br />
                • Double Bottom → Señal LONG 📈
                <br />
                • Double Top → Señal SHORT 📉
                <br />
                <em style={{ fontSize: '11px', color: '#999' }}>
                  Las alertas se envían a http://localhost:5000/api/watchlist-alert
                </em>
              </span>
            ) : (
              <span>
                ⚠️ <strong>Alertas DESACTIVADAS:</strong> No recibirás notificaciones. Habilita este checkbox para activar el sistema de alertas automáticas.
              </span>
            )}
          </div>

          {/* Botón de prueba de alertas */}
          <button
            onClick={handleTestAlert}
            disabled={testAlertStatus === 'testing'}
            style={{
              marginTop: '12px',
              marginLeft: '26px',
              padding: '8px 16px',
              background: testAlertStatus === 'testing' ? '#9E9E9E' :
                         testAlertStatus === 'success' ? '#4CAF50' :
                         testAlertStatus === 'error' ? '#F44336' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: testAlertStatus === 'testing' ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              transition: 'all 0.3s ease'
            }}
          >
            {testAlertStatus === 'testing' ? '⏳ Enviando...' :
             testAlertStatus === 'success' ? '✅ Alerta enviada correctamente!' :
             testAlertStatus === 'error' ? '❌ Error al enviar alerta' :
             '🧪 Test Alert'}
          </button>

          {testAlertStatus === 'success' && (
            <div style={{
              marginTop: '8px',
              marginLeft: '26px',
              fontSize: '11px',
              color: '#4CAF50'
            }}>
              ✓ Revisa la consola del navegador y el servicio de alertas (puerto 5000)
            </div>
          )}

          {testAlertStatus === 'error' && (
            <div style={{
              marginTop: '8px',
              marginLeft: '26px',
              fontSize: '11px',
              color: '#F44336'
            }}>
              ✗ Verifica que el backend esté corriendo (puerto 8000) y revisa la consola
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={{
              padding: '8px 16px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500'
            }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            style={{
              padding: '8px 16px',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500'
            }}
            onClick={handleSave}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DoubleTopBottomSettings;
