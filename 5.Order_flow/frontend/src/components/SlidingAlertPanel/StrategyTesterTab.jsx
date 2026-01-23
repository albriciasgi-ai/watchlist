import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import IndicatorManagerRegistry from '../../utils/IndicatorManagerRegistry';

const PROFILES_KEY = 'watchlist_strategy_profiles';
const ACTIVE_PROFILE_KEY = 'watchlist_active_profile';
const SR_CACHE_KEY = 'watchlist_sr_backtest_cache';
const ALERT_HISTORY_KEY = 'rejection_pattern_global_history';

/**
 * Calcula el uso aproximado de localStorage en bytes
 */
const getLocalStorageUsage = () => {
  let total = 0;
  try {
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
      }
    }
  } catch (e) {
    console.warn('Error calculating localStorage usage:', e);
  }
  return total;
};

/**
 * Limpia datos antiguos de localStorage para liberar espacio
 */
const clearOldLocalStorageData = () => {
  try {
    // 1. Limpiar caché de S/R
    localStorage.removeItem(SR_CACHE_KEY);

    // 2. Limpiar historial de alertas antiguas (mantener solo últimas 50)
    const alertHistory = localStorage.getItem(ALERT_HISTORY_KEY);
    if (alertHistory) {
      try {
        const parsed = JSON.parse(alertHistory);
        if (Array.isArray(parsed) && parsed.length > 50) {
          const trimmed = parsed.slice(-50);
          localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(trimmed));
        }
      } catch (e) {
        localStorage.removeItem(ALERT_HISTORY_KEY);
      }
    }

    // 3. Limpiar datos de patrones alertados por símbolo
    const keysToClean = [];
    for (let key in localStorage) {
      if (key.startsWith('rejection_alerted_') || key.startsWith('rejection_start_')) {
        keysToClean.push(key);
      }
    }
    keysToClean.forEach(key => localStorage.removeItem(key));

    console.log(`[Storage] Cleaned ${keysToClean.length + 2} items from localStorage`);
    return true;
  } catch (e) {
    console.error('Error clearing localStorage:', e);
    return false;
  }
};

// Indicadores disponibles para backtesting
const AVAILABLE_INDICATORS = [
  { value: 'DTB', label: 'Double Top/Bottom' },
  { value: 'REJECTION', label: 'Rejection Patterns' }
];

/**
 * Genera una clave de caché única para la configuración de S/R
 */
const generateSRCacheKey = (symbol, interval, srConfig) => {
  const configHash = JSON.stringify({
    leftBars: srConfig?.leftBars || 15,
    rightBars: srConfig?.rightBars || 15,
    minTouches: srConfig?.minTouches || 1,
    zScoreThreshold: srConfig?.zScoreThreshold || 1.5,
    clusterDistance: srConfig?.clusterDistance || 0.5
  });
  return `${symbol}_${interval}_${configHash}`;
};

/**
 * Carga el caché de S/R desde localStorage
 */
const loadSRCache = () => {
  try {
    const cached = localStorage.getItem(SR_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

/**
 * Guarda el caché de S/R en localStorage
 */
const saveSRCache = (cache) => {
  try {
    localStorage.setItem(SR_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Error saving S/R cache:', e);
  }
};

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
  // Validar que el patrón tiene la estructura esperada
  if (!pattern || !pattern.firstExtreme || !pattern.secondExtreme) {
    console.warn('[calculateStrategyLevels] Pattern missing extremes:', pattern);
    return null;
  }

  const strategyConfig = config?.strategy || {};
  const filtersConfig = config?.filters || {};

  const isLong = pattern.type === 'DOUBLE_BOTTOM';
  const rrRatio = strategyConfig.riskRewardRatio || 2.0;

  // Número de velas de confirmación después del segundo extremo
  const confirmationCandlesCount = filtersConfig.postPatternValidationCandles || 5;

  // Encontrar el índice de la vela del patrón (segundo extremo)
  const patternTimestamp = pattern.secondExtreme?.timestamp;
  if (!patternTimestamp) {
    console.warn('[calculateStrategyLevels] No secondExtreme timestamp:', pattern);
    return null;
  }

  const patternIndex = candles.findIndex(c => {
    const candleTime = c.timestamp || c.time || c.openTime;
    return candleTime === patternTimestamp;
  });

  if (patternIndex < 0) {
    console.warn('[calculateStrategyLevels] Pattern timestamp not found in candles:', patternTimestamp);
    return null;
  }

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

  // Estado para habilitar/deshabilitar validación con S/R
  const [useSRContext, setUseSRContext] = useState(true);

  // Estado para info del último backtest (S/R status, zonas, etc.)
  const [backtestInfo, setBacktestInfo] = useState(null);

  // Estado para progreso del backtest
  const [backtestProgress, setBacktestProgress] = useState(null);

  // Ref para el caché de S/R (evita re-renders innecesarios)
  const srCacheRef = useRef(loadSRCache());

  // Estado para el uso de localStorage
  const [storageUsage, setStorageUsage] = useState(() => {
    const usage = getLocalStorageUsage();
    return { bytes: usage, percent: Math.round((usage / (5 * 1024 * 1024)) * 100) };
  });

  // Actualizar intervalo seleccionado cuando cambia el fullscreen
  useEffect(() => {
    if (fullscreenInterval) {
      setSelectedInterval(fullscreenInterval);
    }
  }, [fullscreenInterval]);

  // Guardar perfiles en localStorage (con manejo de errores y límite de datos)
  useEffect(() => {
    const updateStorageUsage = () => {
      const usage = getLocalStorageUsage();
      setStorageUsage({ bytes: usage, percent: Math.round((usage / (5 * 1024 * 1024)) * 100) });
    };

    try {
      // Limitar resultados por perfil para evitar exceder quota
      const profilesLimited = profiles.map(p => ({
        ...p,
        results: (p.results || []).slice(-100) // Máximo 100 resultados por perfil
      }));
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesLimited));
      updateStorageUsage();
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data...');
        // Limpiar caché de S/R para liberar espacio
        clearOldLocalStorageData();
        srCacheRef.current = {};
        // Intentar guardar con menos resultados
        try {
          const profilesMinimal = profiles.map(p => ({
            ...p,
            results: (p.results || []).slice(-20) // Solo 20 resultados
          }));
          localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesMinimal));
        } catch {
          console.error('Could not save profiles to localStorage');
        }
        updateStorageUsage();
      }
    }
  }, [profiles]);

  useEffect(() => {
    try {
      if (activeProfileId) {
        localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
      }
    } catch (e) {
      console.warn('Could not save active profile:', e);
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

  // Limpiar almacenamiento
  const handleClearStorage = () => {
    if (window.confirm('Esto limpiará el caché de S/R y datos antiguos. Los perfiles se mantendrán.')) {
      clearOldLocalStorageData();
      srCacheRef.current = {};
      const usage = getLocalStorageUsage();
      setStorageUsage({ bytes: usage, percent: Math.round((usage / (5 * 1024 * 1024)) * 100) });
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

        if (useChartConfig) {
          // ===== USAR CONFIGURACIÓN DEL CHART =====
          console.log(`[StrategyTester] Using DTB chart configuration...`);

          const manager = IndicatorManagerRegistry.get(fullscreenSymbol);
          if (!manager) {
            alert('No se encontró el IndicatorManager para este símbolo. Asegúrate de tener el chart abierto.');
            return;
          }

          // Buscar el indicador Double Top/Bottom
          const dtbIndicator = manager.indicators?.find(
            ind => ind.name === 'Double Top/Bottom' || ind.constructor?.name === 'DoubleTopBottomIndicator'
          );

          if (!dtbIndicator) {
            alert('El indicador Double Top/Bottom no está activo en el chart. Actívalo primero.');
            return;
          }

          // Usar la configuración del indicador
          indicatorConfig = { ...dtbIndicator.config };
          console.log(`[StrategyTester] Using DTB config from chart:`, indicatorConfig);

        } else {
          // ===== USAR CONFIGURACIÓN POR DEFECTO =====
          console.log(`[StrategyTester] Using default DTB configuration...`);

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
        }

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
        console.log(`[StrategyTester] Detecting Rejection Patterns with dynamic S/R...`);

        const manager = IndicatorManagerRegistry.get(fullscreenSymbol);
        if (!manager) {
          alert('No se encontró el IndicatorManager para este símbolo. Asegúrate de tener el chart abierto.');
          return;
        }

        // Buscar indicadores
        const rejectionIndicator = manager.indicators?.find(
          ind => ind.name === 'Rejection Patterns' || ind.constructor?.name === 'RejectionPatternIndicator'
        );
        const srIndicator = manager.indicators?.find(
          ind => ind.name === 'Support/Resistance' || ind.constructor?.name === 'SupportResistanceIndicator'
        );

        if (!rejectionIndicator) {
          alert('El indicador Rejection Patterns no está activo en el chart. Actívalo primero.');
          return;
        }

        // Configuración del indicador Rejection
        indicatorConfig = { ...rejectionIndicator.config };
        console.log(`[StrategyTester] Using Rejection config from chart:`, indicatorConfig);

        // Zonas manuales (estáticas - aplican a todo el período)
        const manualZones = indicatorConfig.manualPriceZones || [];
        const staticContexts = [];
        manualZones.forEach(zone => {
          if (zone.enabled) {
            staticContexts.push({
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

        // Incluir referenceContexts configurados (Volume Profile, S/R, etc.)
        const configuredContexts = indicatorConfig.referenceContexts || [];
        configuredContexts.forEach(ctx => {
          if (ctx.enabled) {
            // Para S/R, convertir a zonas manuales basadas en los niveles (solo si useSRContext está activo)
            if (ctx.type === 'SUPPORT_RESISTANCE' && ctx.metadata && useSRContext) {
              const tolerance = 0.003; // 0.3% de tolerancia para crear zonas
              // Crear zonas para resistencias
              (ctx.metadata.resistances || []).forEach((r, idx) => {
                staticContexts.push({
                  id: `sr_resistance_${idx}`,
                  type: 'manual_zone',
                  name: `Resistance ${r.price.toFixed(2)}`,
                  minPrice: r.price * (1 - tolerance),
                  maxPrice: r.price * (1 + tolerance),
                  signalDirection: 'SHORT',
                  enabled: true,
                  weight: ctx.weight || 0.7
                });
              });
              // Crear zonas para soportes
              (ctx.metadata.supports || []).forEach((s, idx) => {
                staticContexts.push({
                  id: `sr_support_${idx}`,
                  type: 'manual_zone',
                  name: `Support ${s.price.toFixed(2)}`,
                  minPrice: s.price * (1 - tolerance),
                  maxPrice: s.price * (1 + tolerance),
                  signalDirection: 'LONG',
                  enabled: true,
                  weight: ctx.weight || 0.7
                });
              });
            } else {
              // Otros tipos de contexto (Volume Profile, etc.)
              staticContexts.push({
                ...ctx,
                enabled: true
              });
            }
          }
        });

        // Configuración de S/R para cálculo dinámico (solo si checkbox está activo)
        const useDynamicSR = useSRContext && srIndicator && srIndicator.enabled && useChartConfig;
        const srConfig = useDynamicSR ? {
          leftBars: srIndicator.leftBars || 15,
          rightBars: srIndicator.rightBars || 15,
          minTouches: srIndicator.minTouches || 1,
          zScoreThreshold: srIndicator.zScoreThreshold || 1.5,
          clusterDistance: srIndicator.clusterDistance || 0.5,
          volumeMethod: srIndicator.volumeMethod || 'zscore'
        } : null;

        // Generar clave de caché
        const cacheKey = useDynamicSR ? generateSRCacheKey(fullscreenSymbol, selectedInterval, srConfig) : null;
        let srCache = cacheKey ? (srCacheRef.current[cacheKey] || {}) : {};
        let cacheHits = 0;
        let cacheMisses = 0;

        console.log(`[StrategyTester] Dynamic S/R: ${useDynamicSR ? 'enabled' : 'disabled'}, Manual zones: ${staticContexts.length}`);

        // PASO 1: Detectar todos los patrones primero
        setBacktestProgress({ phase: 'detecting', current: 0, total: 0, message: 'Detectando patrones...' });

        // Si no hay zonas manuales y no usamos S/R, deshabilitar requireNearLevel
        const hasRealContexts = staticContexts.length > 0;
        const backtestConfig = {
          ...indicatorConfig,
          filters: {
            ...(indicatorConfig.filters || {}),
            // Solo requerir proximidad a nivel si hay contextos configurados
            requireNearLevel: hasRealContexts
          }
        };

        console.log(`[StrategyTester] Backtest config: requireNearLevel=${hasRealContexts}, contexts=${staticContexts.length}`);

        const rejResponse = await fetch(`${API_BASE_URL}/api/rejection-patterns/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: fullscreenSymbol,
            interval: selectedInterval,
            days: testDays,
            config: backtestConfig,
            referenceContexts: hasRealContexts ? staticContexts : [
              // Zona amplia para detección inicial (se filtrará después si hay S/R dinámico)
              { id: 'full_range', type: 'manual_zone', enabled: true, weight: 1.0,
                minPrice: 0, maxPrice: 999999999, signalDirection: 'BOTH' }
            ]
          })
        });

        const rejResult = await rejResponse.json();
        if (!rejResult.success || !rejResult.patterns || rejResult.patterns.length === 0) {
          setBacktestProgress(null);
          alert('No se detectaron patrones en el período seleccionado');
          return;
        }

        patterns = rejResult.patterns;
        console.log(`[StrategyTester] Detected ${patterns.length} patterns, now calculating dynamic S/R...`);

        // PASO 2: Si hay S/R dinámico, calcular para cada patrón
        if (useDynamicSR) {
          const validatedPatterns = [];
          const totalPatterns = patterns.length;

          for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const patternTimestamp = pattern.timestamp;

            setBacktestProgress({
              phase: 'validating',
              current: i + 1,
              total: totalPatterns,
              message: `Validando patrón ${i + 1}/${totalPatterns}...`
            });

            // Calcular cuántos días de datos hay hasta este patrón
            const patternDate = new Date(patternTimestamp);
            const startDate = new Date(candles[0]?.timestamp || candles[0]?.time);
            const daysUntilPattern = Math.ceil((patternDate - startDate) / (1000 * 60 * 60 * 24));

            // Buscar en caché o calcular S/R
            const cacheTimestampKey = `t_${Math.floor(patternTimestamp / (1000 * 60 * 60))}`;  // Agrupar por hora

            let srLevels;
            if (srCache[cacheTimestampKey]) {
              srLevels = srCache[cacheTimestampKey];
              cacheHits++;
            } else {
              // Calcular S/R usando solo datos hasta este patrón
              const candlesUntilPattern = candles.filter(c => {
                const t = c.timestamp || c.time;
                return t <= patternTimestamp;
              });

              if (candlesUntilPattern.length < 50) {
                // No hay suficientes datos, usar niveles vacíos
                srLevels = { resistances: [], supports: [] };
              } else {
                try {
                  // Llamar API de S/R con los días hasta el patrón
                  const srResponse = await fetch(
                    `${API_BASE_URL}/api/support-resistance/${fullscreenSymbol}?` +
                    `interval=${selectedInterval}&days=${Math.max(1, daysUntilPattern)}` +
                    `&min_touches=${srConfig.minTouches}&left_bars=${srConfig.leftBars}` +
                    `&right_bars=${srConfig.rightBars}&z_score_threshold=${srConfig.zScoreThreshold}`
                  );

                  if (srResponse.ok) {
                    const srData = await srResponse.json();
                    srLevels = {
                      resistances: srData.data?.resistances || [],
                      supports: srData.data?.supports || []
                    };
                  } else {
                    srLevels = { resistances: [], supports: [] };
                  }
                } catch (e) {
                  console.warn(`Error calculating S/R for pattern ${i}:`, e);
                  srLevels = { resistances: [], supports: [] };
                }
              }

              // Guardar en caché
              srCache[cacheTimestampKey] = srLevels;
              cacheMisses++;
            }

            // Validar patrón contra niveles S/R de ese momento
            const patternPrice = pattern.price || pattern.close;
            const tolerance = patternPrice * 0.005;
            let isNearSR = false;

            // Verificar si el patrón está cerca de algún S/R
            for (const r of srLevels.resistances) {
              if (Math.abs(patternPrice - r.price) <= tolerance) {
                isNearSR = true;
                pattern._srLevel = { type: 'resistance', price: r.price };
                break;
              }
            }
            if (!isNearSR) {
              for (const s of srLevels.supports) {
                if (Math.abs(patternPrice - s.price) <= tolerance) {
                  isNearSR = true;
                  pattern._srLevel = { type: 'support', price: s.price };
                  break;
                }
              }
            }

            // Si está cerca de zona manual o S/R dinámico, es válido
            const isNearManualZone = staticContexts.some(zone => {
              return patternPrice >= zone.minPrice && patternPrice <= zone.maxPrice;
            });

            if (isNearSR || isNearManualZone || staticContexts.length === 0) {
              validatedPatterns.push(pattern);
            }
          }

          patterns = validatedPatterns;
          console.log(`[StrategyTester] After S/R validation: ${patterns.length} valid patterns (cache: ${cacheHits} hits, ${cacheMisses} misses)`);

          // Guardar caché actualizado
          if (cacheKey) {
            srCacheRef.current[cacheKey] = srCache;
            saveSRCache(srCacheRef.current);
          }
        }

        setBacktestProgress(null);

        // Guardar info del backtest
        const enabledManualZones = manualZones.filter(z => z.enabled).length;
        setBacktestInfo({
          configSource: useChartConfig ? 'chart' : 'auto',
          manualZones: enabledManualZones,
          srInfo: {
            active: useDynamicSR,
            enabled: useSRContext,
            dynamic: true,
            cacheHits: cacheHits,
            cacheMisses: cacheMisses
          },
          totalContexts: staticContexts.length + (useDynamicSR ? '+ S/R dinámico' : 0)
        });

        if (patterns.length === 0) {
          const reason = useDynamicSR
            ? 'No se encontraron patrones válidos cerca de niveles S/R o zonas manuales. Prueba desactivando "Validar con S/R".'
            : 'No se encontraron patrones cerca de las zonas manuales configuradas.';
          alert(reason);
          return;
        }

        console.log(`[StrategyTester] ${patterns.length} patterns ready for evaluation`);
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
          {selectedIndicator === 'REJECTION' && (
            <div className="config-source-selector">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useSRContext}
                  onChange={(e) => setUseSRContext(e.target.checked)}
                />
                <span>Validar con S/R</span>
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

      {/* Progress bar during backtest */}
      {backtestProgress && (
        <div className="backtest-progress-bar">
          <div className="progress-info">
            <span className="progress-phase">
              {backtestProgress.phase === 'detecting' ? '🔍' : '✓'}
            </span>
            <span className="progress-message">{backtestProgress.message}</span>
          </div>
          {backtestProgress.total > 0 && (
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${(backtestProgress.current / backtestProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Backtest info bar - shows S/R status and config source */}
      {backtestInfo && selectedIndicator === 'REJECTION' && !backtestProgress && (
        <div className="backtest-info-bar">
          <span className="info-item">
            <span className="info-label">Config:</span>
            <span className={`info-value ${backtestInfo.configSource}`}>
              {backtestInfo.configSource === 'chart' ? '📊 Chart' : '🔄 Auto'}
            </span>
          </span>
          {backtestInfo.manualZones > 0 && (
            <span className="info-item">
              <span className="info-label">Zonas:</span>
              <span className="info-value">{backtestInfo.manualZones}</span>
            </span>
          )}
          <span className="info-item">
            <span className="info-label">S/R:</span>
            <span className={`info-value ${backtestInfo.srInfo.active ? 'active' : 'inactive'}`}>
              {!backtestInfo.srInfo.enabled
                ? '⏸️ Deshabilitado'
                : backtestInfo.srInfo.active
                  ? backtestInfo.srInfo.dynamic
                    ? '✅ Dinámico'
                    : `✅ ${backtestInfo.srInfo.resistances}R / ${backtestInfo.srInfo.supports}S`
                  : '❌ No activo'}
            </span>
          </span>
          {backtestInfo.srInfo.dynamic && (
            <span className="info-item">
              <span className="info-label">Caché:</span>
              <span className="info-value cache-stats">
                {backtestInfo.srInfo.cacheHits > 0
                  ? `💾 ${backtestInfo.srInfo.cacheHits} hits`
                  : `🔄 ${backtestInfo.srInfo.cacheMisses} cálculos`}
              </span>
            </span>
          )}
        </div>
      )}

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
        <div className="storage-info">
          <span className={`storage-usage ${storageUsage.percent > 80 ? 'warning' : ''}`}>
            {(storageUsage.bytes / 1024).toFixed(0)} KB ({storageUsage.percent}%)
          </span>
          {storageUsage.percent > 50 && (
            <button
              className="clear-storage-btn"
              onClick={handleClearStorage}
              title="Limpiar caché y datos antiguos"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default StrategyTesterTab;
