import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import IndicatorManagerRegistry from '../../utils/IndicatorManagerRegistry';

const PROFILES_KEY = 'watchlist_strategy_profiles';
const ACTIVE_PROFILE_KEY = 'watchlist_active_profile';

// Indicadores disponibles para backtesting
const AVAILABLE_INDICATORS = [
  { value: 'DTB', label: 'Double Top/Bottom' },
  { value: 'REJECTION', label: 'Rejection Patterns' }
];

/**
 * Calcula niveles de estrategia para Rejection Patterns
 * Entry = close del patrón, SL/TP basados en la dirección y RR ratio
 */
const calculateRejectionStrategyLevels = (pattern, candles, rrRatio = 2.0) => {
  // Determinar dirección basada en el tipo de patrón
  const patternType = pattern.pattern_type || pattern.type;
  const isLong = ['hammer', 'bullish_engulfing', 'doji_bullish'].includes(patternType?.toLowerCase());

  // El timestamp del patrón
  const patternTimestamp = pattern.timestamp;
  const patternIndex = candles.findIndex(c => {
    const t = c.timestamp || c.time;
    return t === patternTimestamp;
  });

  if (patternIndex < 0) return null;

  // Entry después de 1 vela de confirmación
  const confirmationIndex = Math.min(patternIndex + 1, candles.length - 1);
  const confirmationCandle = candles[confirmationIndex];
  if (!confirmationCandle) return null;

  const entry = parseFloat(confirmationCandle.close);
  const patternCandle = candles[patternIndex];

  // SL basado en el extremo del patrón
  let stopLoss;
  const slBufferPercent = 10; // 10% buffer

  if (isLong) {
    const patternLow = parseFloat(patternCandle.low);
    const buffer = (entry - patternLow) * (slBufferPercent / 100);
    stopLoss = patternLow - buffer;
  } else {
    const patternHigh = parseFloat(patternCandle.high);
    const buffer = (patternHigh - entry) * (slBufferPercent / 100);
    stopLoss = patternHigh + buffer;
  }

  // Distancia SL
  let slDistance = Math.abs(entry - stopLoss);
  let slPercent = (slDistance / entry) * 100;

  // SL mínimo
  const slMinPercent = 0.3;
  if (slPercent < slMinPercent) {
    slPercent = slMinPercent;
    slDistance = entry * (slMinPercent / 100);
    stopLoss = isLong ? entry - slDistance : entry + slDistance;
  }

  // TP basado en RR ratio
  const takeProfit = isLong
    ? entry + (slDistance * rrRatio)
    : entry - (slDistance * rrRatio);

  const tpPercent = slPercent * rrRatio;

  return {
    entry,
    stopLoss,
    takeProfit,
    slPercent: Math.round(slPercent * 100) / 100,
    tpPercent: Math.round(tpPercent * 100) / 100,
    riskRewardRatio: rrRatio,
    direction: isLong ? 'LONG' : 'SHORT',
    confirmationTimestamp: confirmationCandle.timestamp
  };
};

/**
 * Calcula niveles de estrategia (Entry, SL, TP) para un patrón DTB
 * Replica la lógica del DoubleTopBottomIndicator.calculateStrategyLevels
 */
const calculateStrategyLevels = (pattern, candles, config) => {
  const strategyConfig = config.strategy || {};
  const filtersConfig = config.filters || {};

  const isLong = pattern.type === 'DOUBLE_BOTTOM';
  const rrRatio = strategyConfig.riskRewardRatio || 2.0;

  // Número de velas de confirmación después del segundo extremo
  const confirmationCandlesCount = filtersConfig.postPatternValidationCandles || 5;

  // Encontrar el índice de la vela del patrón (segundo extremo)
  const patternTimestamp = pattern.secondExtreme?.timestamp;
  const patternIndex = candles.findIndex(c => c.timestamp === patternTimestamp);
  if (patternIndex < 0) return null;

  // Calcular el índice de la vela de confirmación
  const confirmationIndex = Math.min(patternIndex + confirmationCandlesCount, candles.length - 1);
  const confirmationCandle = candles[confirmationIndex];

  if (!confirmationCandle) return null;

  // Entry = close de la vela de confirmación
  const entry = parseFloat(confirmationCandle.close);

  // Parámetros para SL
  const slBufferPercent = strategyConfig.slBufferPercent || 20;
  const slMinPercent = strategyConfig.slMinPercent || 0.5;

  // Calcular SL basado en el patrón
  let stopLoss;
  if (isLong) {
    // Para LONG: SL debajo del patrón
    const patternLow = Math.min(
      parseFloat(pattern.firstExtreme.price),
      parseFloat(pattern.secondExtreme.price)
    );
    const distanceToLow = entry - patternLow;
    const buffer = distanceToLow * (slBufferPercent / 100);
    stopLoss = patternLow - buffer;
  } else {
    // Para SHORT: SL encima del patrón
    const patternHigh = Math.max(
      parseFloat(pattern.firstExtreme.price),
      parseFloat(pattern.secondExtreme.price)
    );
    const distanceToHigh = patternHigh - entry;
    const buffer = distanceToHigh * (slBufferPercent / 100);
    stopLoss = patternHigh + buffer;
  }

  // Calcular distancia del SL como porcentaje
  let slDistance = Math.abs(entry - stopLoss);
  let slPercent = (slDistance / entry) * 100;

  // Aplicar SL mínimo si es necesario
  if (slPercent < slMinPercent) {
    slPercent = slMinPercent;
    slDistance = entry * (slMinPercent / 100);
    if (isLong) {
      stopLoss = entry - slDistance;
    } else {
      stopLoss = entry + slDistance;
    }
  }

  // Take Profit basado en Risk:Reward ratio
  let takeProfit;
  if (isLong) {
    takeProfit = entry + (slDistance * rrRatio);
  } else {
    takeProfit = entry - (slDistance * rrRatio);
  }

  const tpPercent = slPercent * rrRatio;

  return {
    entry,
    stopLoss,
    takeProfit,
    slPercent: Math.round(slPercent * 100) / 100,
    tpPercent: Math.round(tpPercent * 100) / 100,
    riskRewardRatio: rrRatio,
    direction: isLong ? 'LONG' : 'SHORT',
    confirmationTimestamp: confirmationCandle.timestamp
  };
};

// Intervalos disponibles para backtesting
const AVAILABLE_INTERVALS = [
  { value: '1', label: '1m' },
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: 'D', label: '1D' }
];

/**
 * Tab de Tester de Estrategias
 * Permite hacer backtesting sobre datos históricos del símbolo en fullscreen
 */
const StrategyTesterTab = ({ isOpen, fullscreenSymbol, fullscreenInterval }) => {
  // Debug: log props
  console.log(`[StrategyTesterTab] Props: fullscreenSymbol=${fullscreenSymbol}, fullscreenInterval=${fullscreenInterval}`);

  const [profiles, setProfiles] = useState(() => {
    try {
      const stored = localStorage.getItem(PROFILES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [activeProfileId, setActiveProfileId] = useState(() => {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
  });
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [testResults, setTestResults] = useState([]);
  const [riskAmount, setRiskAmount] = useState(100);
  const [testDays, setTestDays] = useState(30);
  const [showNewProfileForm, setShowNewProfileForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Estado para el intervalo seleccionado (independiente del fullscreen)
  const [selectedInterval, setSelectedInterval] = useState(fullscreenInterval || '60');

  // Estado para el indicador seleccionado
  const [selectedIndicator, setSelectedIndicator] = useState('DTB');

  // Estado para usar configuración del chart vs S/R automático
  const [useChartConfig, setUseChartConfig] = useState(true);

  // Actualizar intervalo seleccionado cuando cambia el fullscreen
  useEffect(() => {
    if (fullscreenInterval) {
      setSelectedInterval(fullscreenInterval);
    }
  }, [fullscreenInterval]);

  // Guardar perfiles en localStorage
  useEffect(() => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    if (activeProfileId) {
      localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
    }
  }, [activeProfileId]);

  // Perfil activo
  const activeProfile = useMemo(() => {
    return profiles.find(p => p.id === activeProfileId) || null;
  }, [profiles, activeProfileId]);

  // Crear nuevo perfil
  const handleCreateProfile = () => {
    if (!newProfileName.trim()) return;

    const newProfile = {
      id: `profile_${Date.now()}`,
      name: newProfileName.trim(),
      createdAt: Date.now(),
      symbol: fullscreenSymbol || 'BTCUSDT',
      interval: fullscreenInterval || '15',
      results: [],
      settings: {
        riskAmount: 100,
        testDays: 30
      }
    };

    setProfiles([...profiles, newProfile]);
    setActiveProfileId(newProfile.id);
    setNewProfileName('');
    setShowNewProfileForm(false);
    setTestResults([]);
  };

  // Eliminar perfil
  const handleDeleteProfile = (profileId) => {
    setProfiles(profiles.filter(p => p.id !== profileId));
    if (activeProfileId === profileId) {
      setActiveProfileId(profiles.length > 1 ? profiles[0].id : null);
      setTestResults([]);
    }
  };

  // Seleccionar perfil
  const handleSelectProfile = (profileId) => {
    setActiveProfileId(profileId);
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      setTestResults(profile.results || []);
      setRiskAmount(profile.settings?.riskAmount || 100);
      setTestDays(profile.settings?.testDays || 30);
    }
  };

  // Helper para evaluar outcome de un patrón
  const evaluatePatternOutcome = (strategy, candles, patternType, idx) => {
    if (!strategy) {
      return {
        id: `pattern_${idx}`,
        type: patternType,
        outcome: 'INCOMPLETE',
        reason: 'No se pudo calcular estrategia'
      };
    }

    const { entry, stopLoss, takeProfit, direction, slPercent, tpPercent, confirmationTimestamp } = strategy;

    const getCandleTime = (c) => {
      const t = c.timestamp || c.time || c.openTime || c.start;
      return t < 1000000000000 ? t * 1000 : t;
    };

    const candlesAfterEntry = candles
      .filter(c => getCandleTime(c) > confirmationTimestamp)
      .sort((a, b) => getCandleTime(a) - getCandleTime(b));

    const baseResult = {
      id: `pattern_${idx}`,
      type: patternType,
      timestamp: confirmationTimestamp,
      entry,
      stopLoss,
      takeProfit,
      direction,
      slPercent,
      tpPercent
    };

    if (candlesAfterEntry.length === 0) {
      return { ...baseResult, outcome: 'PENDING', reason: 'Sin datos posteriores' };
    }

    for (const candle of candlesAfterEntry) {
      const high = parseFloat(candle.high);
      const low = parseFloat(candle.low);

      if (direction === 'LONG') {
        if (low <= stopLoss) {
          return { ...baseResult, outcome: 'LOSS', exitPrice: stopLoss, exitTime: getCandleTime(candle) };
        }
        if (high >= takeProfit) {
          return { ...baseResult, outcome: 'WIN', exitPrice: takeProfit, exitTime: getCandleTime(candle) };
        }
      } else {
        if (high >= stopLoss) {
          return { ...baseResult, outcome: 'LOSS', exitPrice: stopLoss, exitTime: getCandleTime(candle) };
        }
        if (low <= takeProfit) {
          return { ...baseResult, outcome: 'WIN', exitPrice: takeProfit, exitTime: getCandleTime(candle) };
        }
      }
    }

    return { ...baseResult, outcome: 'PENDING', reason: 'Trade aún abierto' };
  };

  // Evaluar estrategia con datos históricos
  const runBacktest = useCallback(async () => {
    if (!fullscreenSymbol) {
      alert('Necesitas tener un símbolo en fullscreen para hacer backtesting');
      return;
    }

    setIsEvaluating(true);
    setTestResults([]);

    try {
      console.log(`[StrategyTester] Starting backtest for ${fullscreenSymbol}, indicator: ${selectedIndicator}, interval: ${selectedInterval}, days: ${testDays}`);

      // 1. Fetch historical candles
      const candlesResponse = await fetch(
        `${API_BASE_URL}/api/historical/${fullscreenSymbol}?interval=${selectedInterval}&days=${testDays}`
      );

      if (!candlesResponse.ok) {
        throw new Error('Error fetching historical data');
      }

      const candlesData = await candlesResponse.json();
      const candles = candlesData.success ? (candlesData.data || candlesData.candles || []) : [];

      console.log(`[StrategyTester] Fetched ${candles.length} candles`);

      if (candles.length === 0) {
        alert('No se encontraron datos históricos');
        return;
      }

      let patterns = [];
      let indicatorConfig = {};

      // 2. Detectar patrones según el indicador seleccionado
      if (selectedIndicator === 'DTB') {
        // ===== DOUBLE TOP/BOTTOM =====
        console.log(`[StrategyTester] Detecting DTB patterns...`);

        indicatorConfig = {
          enabled: true,
          doubleTopBottom: {
            minDistanceBars: 5,
            maxDistanceBars: 100,
            priceTolerancePercent: 1.5,
            maxBreakoutPercent: 3.0,
            volumeFilter: { enabled: false }
          },
          filters: {
            minConfidence: 20,
            requireBothRejections: false,
            postPatternValidationCandles: 5
          },
          strategy: {
            enabled: true,
            riskRewardRatio: 2.0,
            slMinPercent: 0.5,
            slBufferPercent: 20
          }
        };

        const dtbResponse = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: fullscreenSymbol,
            interval: selectedInterval,
            days: testDays,
            config: indicatorConfig,
            candles: candles
          })
        });

        const dtbResult = await dtbResponse.json();
        if (dtbResult.success && dtbResult.patterns) {
          patterns = dtbResult.patterns;
        }

      } else if (selectedIndicator === 'REJECTION') {
        // ===== REJECTION PATTERNS =====
        console.log(`[StrategyTester] Detecting Rejection Patterns...`);

        let referenceContexts = [];

        if (useChartConfig) {
          // ===== USAR CONFIGURACIÓN DEL CHART =====
          console.log(`[StrategyTester] Using chart configuration...`);

          const manager = IndicatorManagerRegistry.get(fullscreenSymbol);
          if (!manager) {
            alert('No se encontró el IndicatorManager para este símbolo. Asegúrate de tener el chart abierto.');
            return;
          }

          // Buscar el indicador Rejection Patterns
          const rejectionIndicator = manager.indicators?.find(
            ind => ind.name === 'Rejection Patterns' || ind.constructor?.name === 'RejectionPatternIndicator'
          );

          if (!rejectionIndicator) {
            alert('El indicador Rejection Patterns no está activo en el chart. Actívalo primero.');
            return;
          }

          // Usar la configuración del indicador
          indicatorConfig = { ...rejectionIndicator.config };
          console.log(`[StrategyTester] Using Rejection config from chart:`, indicatorConfig);

          // Obtener zonas manuales del indicador
          const manualZones = indicatorConfig.manualPriceZones || [];
          const configContexts = indicatorConfig.referenceContexts || [];

          // Construir contextos de referencia (igual que buildAllReferenceContexts en el indicador)
          referenceContexts = [...configContexts];

          // Agregar zonas manuales como contextos
          manualZones.forEach(zone => {
            if (zone.enabled) {
              referenceContexts.push({
                id: zone.id,
                type: 'manual_zone',
                name: zone.name,
                minPrice: zone.minPrice,
                maxPrice: zone.maxPrice,
                signalDirection: zone.signalDirection,
                color: zone.color,
                enabled: true,
                weight: 0.8
              });
            }
          });

          console.log(`[StrategyTester] Found ${manualZones.length} manual zones, ${configContexts.length} reference contexts`);

          // Si el indicador S/R está activo, agregar sus niveles también
          const srIndicator = manager.indicators?.find(
            ind => ind.name === 'Support/Resistance' || ind.constructor?.name === 'SupportResistanceIndicator'
          );

          if (srIndicator && srIndicator.enabled) {
            const srResistances = srIndicator.resistances || [];
            const srSupports = srIndicator.supports || [];

            console.log(`[StrategyTester] S/R indicator active: ${srResistances.length} resistances, ${srSupports.length} supports`);

            // Agregar niveles S/R como zonas de referencia
            srResistances.forEach((level, idx) => {
              const price = parseFloat(level.price);
              const tolerance = price * 0.005;
              referenceContexts.push({
                id: `sr_resistance_${idx}`,
                type: 'manual_zone',
                name: `Resistance @ ${price.toFixed(2)}`,
                minPrice: price - tolerance,
                maxPrice: price + tolerance,
                signalDirection: 'SHORT',
                enabled: true,
                weight: 0.7
              });
            });

            srSupports.forEach((level, idx) => {
              const price = parseFloat(level.price);
              const tolerance = price * 0.005;
              referenceContexts.push({
                id: `sr_support_${idx}`,
                type: 'manual_zone',
                name: `Support @ ${price.toFixed(2)}`,
                minPrice: price - tolerance,
                maxPrice: price + tolerance,
                signalDirection: 'LONG',
                enabled: true,
                weight: 0.7
              });
            });
          }

          console.log(`[StrategyTester] Total reference contexts: ${referenceContexts.length}`);

        } else {
          // ===== USAR S/R AUTOMÁTICO =====
          console.log(`[StrategyTester] Using automatic S/R levels...`);

          const srResponse = await fetch(
            `${API_BASE_URL}/api/support-resistance/${fullscreenSymbol}?interval=${selectedInterval}&days=${testDays}&min_touches=1&max_levels=20`
          );

          if (srResponse.ok) {
            const srData = await srResponse.json();
            const resistances = srData.data?.resistances || [];
            const supports = srData.data?.supports || [];

            const allLevels = [
              ...resistances.map(r => ({ ...r, levelType: 'RESISTANCE' })),
              ...supports.map(s => ({ ...s, levelType: 'SUPPORT' }))
            ];

            console.log(`[StrategyTester] Found ${allLevels.length} S/R levels`);

            referenceContexts = allLevels.map((level, idx) => {
              const price = parseFloat(level.price);
              const tolerance = price * 0.005;
              const signalDirection = level.levelType === 'SUPPORT' ? 'LONG' : 'SHORT';

              return {
                id: `sr_level_${idx}`,
                type: 'manual_zone',
                name: `${level.levelType} @ ${price.toFixed(2)}`,
                enabled: true,
                weight: 0.8,
                minPrice: price - tolerance,
                maxPrice: price + tolerance,
                signalDirection: signalDirection
              };
            });
          }

          // Configuración por defecto si no se usa la del chart
          indicatorConfig = {
            enabled: true,
            patterns: {
              hammer: { enabled: true, minWickRatio: 1.5 },
              shootingStar: { enabled: true, minWickRatio: 1.5 },
              engulfing: { enabled: true },
              doji: { enabled: true }
            },
            swingDetection: {
              enabled: true,
              leftBars: 3,
              rightBars: 3,
              required: false
            },
            filters: {
              minConfidence: 20,
              requireNearLevel: false,
              proximityPercent: 1.0
            }
          };
        }

        // Validar que hay contextos de referencia
        if (referenceContexts.length === 0) {
          alert('No hay zonas de referencia configuradas. Agrega zonas manuales en el indicador Rejection Patterns o activa el indicador S/R.');
          return;
        }

        console.log(`[StrategyTester] Calling Rejection Patterns API with ${referenceContexts.length} reference contexts...`);

        const rejResponse = await fetch(`${API_BASE_URL}/api/rejection-patterns/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: fullscreenSymbol,
            interval: selectedInterval,
            days: testDays,
            config: indicatorConfig,
            referenceContexts: referenceContexts
          })
        });

        const rejResult = await rejResponse.json();
        if (rejResult.success && rejResult.patterns) {
          patterns = rejResult.patterns;
        }
      }

      console.log(`[StrategyTester] Detected ${patterns.length} ${selectedIndicator} patterns`);

      if (patterns.length === 0) {
        alert(`No se detectaron patrones ${selectedIndicator === 'DTB' ? 'Double Top/Bottom' : 'Rejection'} en el período seleccionado`);
        return;
      }

      // 3. Evaluar cada patrón
      const evaluatedResults = patterns.map((pattern, idx) => {
        let strategy;

        if (selectedIndicator === 'DTB') {
          strategy = calculateStrategyLevels(pattern, candles, indicatorConfig);
        } else {
          strategy = calculateRejectionStrategyLevels(pattern, candles, 2.0);
        }

        const result = evaluatePatternOutcome(strategy, candles, pattern.type || pattern.pattern_type, idx);
        // Add indicator field to result
        return { ...result, indicator: selectedIndicator };
      });

      console.log(`[StrategyTester] Evaluated ${evaluatedResults.length} patterns`);
      setTestResults(evaluatedResults);

      // Guardar resultados en el perfil
      if (activeProfileId) {
        setProfiles(profiles.map(p =>
          p.id === activeProfileId
            ? {
                ...p,
                results: evaluatedResults,
                symbol: fullscreenSymbol,
                interval: selectedInterval,
                indicator: selectedIndicator,
                lastTestAt: Date.now(),
                settings: { riskAmount, testDays }
              }
            : p
        ));
      }

    } catch (error) {
      console.error('Error in backtest:', error);
      alert('Error al ejecutar backtest: ' + error.message);
    } finally {
      setIsEvaluating(false);
    }
  }, [fullscreenSymbol, selectedIndicator, selectedInterval, testDays, activeProfileId, profiles, riskAmount, useChartConfig]);

  // Calcular estadísticas
  const stats = useMemo(() => {
    const wins = testResults.filter(r => r.outcome === 'WIN').length;
    const losses = testResults.filter(r => r.outcome === 'LOSS').length;
    const pending = testResults.filter(r => r.outcome === 'PENDING').length;
    const completed = wins + losses;
    const winRate = completed > 0 ? (wins / completed * 100).toFixed(1) : 0;

    // Calculate P/L
    let totalPL = 0;
    testResults.forEach(r => {
      if (r.outcome === 'WIN') {
        const slPercent = Math.abs(r.slPercent || 0);
        const tpPercent = Math.abs(r.tpPercent || 0);
        const rr = slPercent > 0 ? tpPercent / slPercent : 0;
        totalPL += riskAmount * rr;
      } else if (r.outcome === 'LOSS') {
        totalPL -= riskAmount;
      }
    });

    return { wins, losses, pending, completed, winRate, totalPL, total: testResults.length };
  }, [testResults, riskAmount]);

  // Funciones de formato
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${parseFloat(value).toFixed(2)}`;
  };

  const getOutcomeClass = (outcome) => {
    if (outcome === 'WIN') return 'outcome-win';
    if (outcome === 'LOSS') return 'outcome-loss';
    return 'outcome-pending';
  };

  return (
    <>
      {/* Toolbar */}
      <div className="panel-toolbar tester-toolbar">
        <div className="toolbar-left">
          <div className="symbol-display">
            <span className="symbol-label">Símbolo:</span>
            <span className={`symbol-value ${fullscreenSymbol ? '' : 'no-symbol'}`}>
              {fullscreenSymbol || 'Sin fullscreen'}
            </span>
          </div>
          <div className="indicator-selector">
            <label>Indicador:</label>
            <select
              value={selectedIndicator}
              onChange={(e) => setSelectedIndicator(e.target.value)}
              className="indicator-select"
            >
              {AVAILABLE_INDICATORS.map(ind => (
                <option key={ind.value} value={ind.value}>{ind.label}</option>
              ))}
            </select>
          </div>
          <div className="interval-selector">
            <label>Intervalo:</label>
            <select
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value)}
              className="interval-select"
            >
              {AVAILABLE_INTERVALS.map(int => (
                <option key={int.value} value={int.value}>{int.label}</option>
              ))}
            </select>
          </div>
          {selectedIndicator === 'REJECTION' && (
            <div className="config-source-selector">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useChartConfig}
                  onChange={(e) => setUseChartConfig(e.target.checked)}
                />
                <span>Usar config del chart</span>
              </label>
            </div>
          )}
        </div>
        <div className="toolbar-right">
          <div className="test-config">
            <label>Días:</label>
            <input
              type="number"
              value={testDays}
              onChange={(e) => setTestDays(parseInt(e.target.value) || 7)}
              min="1"
              max="365"
              className="days-input"
            />
          </div>
          <div className="risk-input-container">
            <label>Riesgo:</label>
            <div className="risk-input-wrapper">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                value={riskAmount}
                onChange={(e) => setRiskAmount(parseFloat(e.target.value) || 0)}
                min="0"
                step="10"
                className="risk-input"
              />
            </div>
          </div>
          <button
            className={`toolbar-btn run-btn ${isEvaluating ? 'evaluating' : ''}`}
            onClick={runBacktest}
            disabled={isEvaluating || !fullscreenSymbol}
            title="Ejecutar backtest"
          >
            {isEvaluating ? '⏳ Evaluando...' : '▶️ Ejecutar Test'}
          </button>
        </div>
      </div>

      {/* Profiles bar */}
      <div className="profiles-bar">
        <div className="profiles-list">
          {profiles.map(profile => (
            <div
              key={profile.id}
              className={`profile-btn ${profile.id === activeProfileId ? 'active' : ''}`}
              onClick={() => handleSelectProfile(profile.id)}
              role="button"
              tabIndex={0}
            >
              <span className="profile-name">{profile.name}</span>
              {profile.results?.length > 0 && (
                <span className="profile-count">{profile.results.length}</span>
              )}
              <button
                className="profile-delete"
                onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                title="Eliminar perfil"
              >
                ×
              </button>
            </div>
          ))}
          {!showNewProfileForm ? (
            <button className="profile-btn add-profile" onClick={() => setShowNewProfileForm(true)}>
              + Nuevo Perfil
            </button>
          ) : (
            <div className="new-profile-form">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Nombre del perfil"
                className="profile-name-input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
              />
              <button className="profile-save" onClick={handleCreateProfile}>✓</button>
              <button className="profile-cancel" onClick={() => { setShowNewProfileForm(false); setNewProfileName(''); }}>✕</button>
            </div>
          )}
        </div>
      </div>

      {/* Stats summary */}
      {testResults.length > 0 && (
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-label">Total</span>
            <span className="stat-value">{stats.total}</span>
          </div>
          <div className="stat-item wins">
            <span className="stat-label">Wins</span>
            <span className="stat-value">{stats.wins}</span>
          </div>
          <div className="stat-item losses">
            <span className="stat-label">Losses</span>
            <span className="stat-value">{stats.losses}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Pending</span>
            <span className="stat-value">{stats.pending}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Win Rate</span>
            <span className="stat-value">{stats.winRate}%</span>
          </div>
          <div className={`stat-item ${stats.totalPL >= 0 ? 'profit' : 'loss'}`}>
            <span className="stat-label">P/L</span>
            <span className="stat-value">{stats.totalPL >= 0 ? '+' : ''}${stats.totalPL.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="panel-content">
        {!fullscreenSymbol ? (
          <div className="empty-state">
            <span className="empty-icon">🔍</span>
            <p>Abre un símbolo en fullscreen</p>
            <p className="empty-hint">El tester usa el símbolo que tengas en pantalla completa</p>
          </div>
        ) : testResults.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">🧪</span>
            <p>Listo para testing</p>
            <p className="empty-hint">
              {activeProfile
                ? `Perfil: ${activeProfile.name} • Click "Ejecutar Test" para evaluar`
                : 'Crea un perfil y ejecuta el test'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="alerts-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Indicador</th>
                  <th>Dirección</th>
                  <th>Entrada</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Resultado</th>
                  <th>Salida</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map((result, index) => (
                  <tr key={result.id || index} className={result.direction === 'LONG' ? 'direction-long' : 'direction-short'}>
                    <td className="cell-date">{formatDate(result.timestamp)}</td>
                    <td className="cell-time">{formatTime(result.timestamp)}</td>
                    <td className="cell-indicator">
                      <span className={`indicator-badge ${result.indicator?.toLowerCase()}`}>
                        {result.indicator}
                      </span>
                    </td>
                    <td className="cell-direction">
                      <span className={`direction-badge ${result.direction?.toLowerCase()}`}>
                        {result.direction}
                      </span>
                    </td>
                    <td className="cell-price">{formatPrice(result.entry)}</td>
                    <td className="cell-sl">{formatPrice(result.stopLoss)}</td>
                    <td className="cell-tp">{formatPrice(result.takeProfit)}</td>
                    <td className="cell-outcome">
                      <span className={`outcome-badge ${getOutcomeClass(result.outcome)}`}>
                        {result.outcome}
                      </span>
                    </td>
                    <td className="cell-exit">
                      {result.exitPrice ? formatPrice(result.exitPrice) : (result.reason || '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="panel-footer">
        <span className="footer-info">
          {activeProfile
            ? `Perfil: ${activeProfile.name} • ${fullscreenSymbol || 'Sin símbolo'}`
            : 'Selecciona o crea un perfil para guardar resultados'}
        </span>
      </div>
    </>
  );
};

export default StrategyTesterTab;
