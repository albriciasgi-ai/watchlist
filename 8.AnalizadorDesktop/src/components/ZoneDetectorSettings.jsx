// ZoneDetectorSettings.jsx
// Panel para configurar y ejecutar la detección de zonas de trading

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';
import { API_BASE_URL } from '../config';

// Presets se persisten en backend (config/zone_detector_presets.json)

const defaultParams = {
  // Metodo de deteccion
  detection_method: "trading_zones",  // "trading_zones" (consol) o "atr_dynamic"
  // Consolidation method params
  consol_min_bars: 8,
  consol_max_bars: 50,
  consol_max_range_pct: 2.0,
  consol_atr_ratio: 0.6,
  consol_body_ratio: 0.7,
  consol_max_outside_bars: 3,
  lookforward_bars: 100,
  max_price_range_pct: 5.0,
  entry_mode: "breakout_close",
  position_mode: "sequential",
  swing_bars: 5,
  sl_mode: "zone_opposite",
  // ATR Dynamic method params (nuevo)
  atr_dyn_period: 200,
  atr_dyn_ma_period: 20,
  atr_dyn_multiplier: 1.0,
  atr_dyn_min_bars: 0,
  atr_dyn_max_breakout: 5,
  atr_dyn_merge_overlap: true,
  // Capas v3.0
  use_atr_band: false,
  atr_band_period: 200,
  atr_band_multiplier: 1.0,
  atr_band_ma_period: 20,
  use_reentry: false,
  max_reentry_bars: 3,
  use_ttm_prefilter: false,
  ttm_atr_length: 20,
  ttm_kc_multiplier: 1.5,
  ttm_min_squeeze_bars: 5,
  use_bbwp_scoring: false,
  bbwp_lookback: 252,
  bbwp_squeeze_threshold: 20,
  bbwp_history_days: 0,  // 0 = usar mismos datos, >0 = dias extra de historial para BBWP
  use_inside_pct_filter: false,
  min_inside_pct: 70.0,
  // Grace bars (tolerancia)
  grace_bars: 2,            // Velas fallidas permitidas antes de cerrar zona
  // Risk:Reward ratio para TP
  tp_rr_ratio: 2.0,
  // Filtro de calidad
  min_score_filter: 0,  // 0 = sin filtro, >0 = score minimo para incluir zona
  use_continuation_score: false,  // Solo usar con swing_confirmation (ya pasaron velas)
  // Volume Profile por zona (para va_breakout)
  sl_poc_buffer_pct: 50.0,  // % buffer sobre distancia entry->POC para SL
  vp_bins_per_zone: 30      // Bins de precio para VP de cada zona
};

// Limites maximos de dias por timeframe para deteccion de zonas
// (coincide con MAX_DAYS_ZONES del backend - limites extendidos para backtesting)
const MAX_DAYS_BY_INTERVAL = {
  "1": 400, "3": 400, "5": 400, "15": 730, "30": 730,
  "60": 1095, "120": 1095, "240": 1095, "D": 2000, "W": 1000
};

// Dias por defecto para deteccion de zonas
const DEFAULT_ZONE_DAYS_BY_INTERVAL = {
  "1": 3, "3": 7, "5": 60, "15": 90, "30": 120,
  "60": 180, "120": 180, "240": 365, "D": 730, "W": 730
};

// Simbolos disponibles para multi-simbolo
const MULTI_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "XRPUSDT", "TRXUSDT", "GALAUSDT",
  "SUIUSDT", "TRBUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT",
  "LINKUSDT", "BNBUSDT", "AVAXUSDT", "MATICUSDT", "DOTUSDT",
  "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT",
  "OPUSDT", "INJUSDT", "SEIUSDT", "TIAUSDT", "JUPUSDT",
  "WIFUSDT", "PEPEUSDT", "BONKUSDT", "FLOKIUSDT", "SHIBUSDT"
];

// Campos que son strings (no numericos) - fuera del componente para estabilidad
const STRING_PARAMS = ['entry_mode', 'position_mode', 'sl_mode', 'detection_method'];
// Campos booleanos (toggles de capas)
const BOOL_PARAMS = ['use_atr_band', 'use_reentry', 'use_ttm_prefilter', 'use_bbwp_scoring', 'use_inside_pct_filter', 'atr_dyn_merge_overlap', 'use_continuation_score'];

function ZoneDetectorSettings({ isOpen, onClose, indicatorManager, onZonesLoaded, symbol, interval, onRealtimeChange }) {
  // Calcular maxDays y defaultDays basados en interval (reactivos)
  // Asegurar que interval sea string para buscar en el objeto
  const maxDays = useMemo(() => {
    const key = String(interval);
    const max = MAX_DAYS_BY_INTERVAL[key];
    console.log(`[ZoneDetector] interval=${key}, maxDays=${max}`);
    return max || 400;
  }, [interval]);
  const defaultDays = useMemo(() => DEFAULT_ZONE_DAYS_BY_INTERVAL[String(interval)] || 60, [interval]);

  const [params, setParams] = useState(defaultParams);
  const [zoneDays, setZoneDays] = useState(defaultDays);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, message }
  const [stats, setStats] = useState(null);
  const [candlesCount, setCandlesCount] = useState(null);
  const [csvPath, setCsvPath] = useState(null);
  const [error, setError] = useState(null);

  // === VOLUME PROFILE EN ZONAS ===
  const [detectedZones, setDetectedZones] = useState([]);
  const [vpLoading, setVpLoading] = useState(false);
  const [vpCount, setVpCount] = useState(0);
  const VP_MAX = 50; // Maximo de Volume Profiles

  // === ALERTAS AL TRADING BOT ===
  const [alertsEnabled, setAlertsEnabled] = useState(() => {
    try { return localStorage.getItem('zoneDetector_alertsEnabled') === 'true'; } catch { return false; }
  });
  const [tradingBotUrl, setTradingBotUrl] = useState(() => {
    try { return localStorage.getItem('zoneDetector_tradingBotUrl') || 'http://localhost:5000'; } catch { return 'http://localhost:5000'; }
  });
  const [alertSending, setAlertSending] = useState(false);
  const [alertResult, setAlertResult] = useState(null); // { sent, failed, total_valid, results }
  const [alertOrderType, setAlertOrderType] = useState(() => {
    try { return localStorage.getItem('zoneDetector_alertOrderType') || 'market'; } catch { return 'market'; }
  });

  // === REALTIME ZONE DETECTION SERVICE ===
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeRunning, setRealtimeRunning] = useState(false);
  const [detectionPaused, setDetectionPaused] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState(null);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [realtimeWindowCandles, setRealtimeWindowCandles] = useState(500);
  const [realtimeCooldown, setRealtimeCooldown] = useState(30);
  const [realtimeMinScore, setRealtimeMinScore] = useState(0);
  const [realtimeSlMode, setRealtimeSlMode] = useState('zone_opposite'); // "zone_opposite" o "va_poc"
  const [realtimeSlPocBuffer, setRealtimeSlPocBuffer] = useState(50);
  const [realtimeConfigMsg, setRealtimeConfigMsg] = useState(null); // {type: 'ok'|'error', text}
  const realtimePollingRef = useRef(null);

  // === OPTIMIZACION ===
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optRunning, setOptRunning] = useState(false);
  const [optProgress, setOptProgress] = useState(null); // { current, total, percent, eta, best_so_far }
  const [optResults, setOptResults] = useState(null); // { results, total_combos, elapsed, metric }
  const [optMetric, setOptMetric] = useState('expectancy'); // Metrica objetivo
  const [optEstimate, setOptEstimate] = useState(null); // { estimated_seconds, total_combos, candles }
  const [optEstimating, setOptEstimating] = useState(false);
  const [optParamRanges, setOptParamRanges] = useState({
    // Parametros clave para optimizar con rangos por defecto
    atr_dyn_multiplier: { enabled: true, min: 0.5, max: 2.0, step: 0.25 },
    atr_dyn_ma_period: { enabled: true, min: 10, max: 40, step: 5 },
    atr_dyn_max_breakout: { enabled: false, min: 2, max: 10, step: 2 },
    consol_max_range_pct: { enabled: false, min: 1.0, max: 4.0, step: 0.5 },
    min_score_filter: { enabled: false, min: 0, max: 60, step: 10 },
    lookforward_bars: { enabled: false, min: 50, max: 200, step: 25 },
    atr_dyn_period: { enabled: false, min: 100, max: 300, step: 50 },
    ttm_atr_length: { enabled: false, min: 10, max: 30, step: 5 },
    ttm_kc_multiplier: { enabled: false, min: 1.0, max: 2.5, step: 0.25 },
    ttm_min_squeeze_bars: { enabled: false, min: 3, max: 10, step: 1 },
    tp_rr_ratio: { enabled: false, min: 1.0, max: 5.0, step: 0.5 },
  });

  // === OPTIMIZACION V2 (Realtime Engine) ===
  const [showOptimizerV2, setShowOptimizerV2] = useState(false);
  const [optV2Running, setOptV2Running] = useState(false);
  const [optV2Results, setOptV2Results] = useState(null);
  const [optV2Metric, setOptV2Metric] = useState('expectancy');
  const [optV2Estimate, setOptV2Estimate] = useState(null);
  const [optV2Estimating, setOptV2Estimating] = useState(false);
  const [optV2ParamRanges, setOptV2ParamRanges] = useState({
    multiplier: { enabled: true, min: 0.5, max: 3.0, step: 0.25 },
    ma_period: { enabled: true, min: 10, max: 40, step: 5 },
    atr_period: { enabled: false, min: 50, max: 300, step: 50 },
    max_outside_bars: { enabled: false, min: 2, max: 10, step: 2 },
    min_bars: { enabled: false, min: 4, max: 20, step: 2 },
    max_range_pct: { enabled: false, min: 2.0, max: 10.0, step: 1.0 },
    body_ratio: { enabled: false, min: 0.3, max: 1.0, step: 0.1 },
    breakout_confirm_bars: { enabled: false, min: 1, max: 6, step: 1 },
    tp_rr_ratio: { enabled: false, min: 0.5, max: 4.0, step: 0.5 },
    sl_poc_buffer_pct: { enabled: false, min: 10, max: 100, step: 10 },
    ttm_kc_multiplier: { enabled: false, min: 0.5, max: 2.5, step: 0.25 },
    ttm_min_squeeze_bars: { enabled: false, min: 3, max: 15, step: 2 },
    grace_bars: { enabled: false, min: 0, max: 5, step: 1 },
  });

  // === MULTI-SIMBOLO ===
  const [multiMode, setMultiMode] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState([]);
  const [multiResults, setMultiResults] = useState(null); // { symbol_results, consolidated_stats, all_zones }

  // === PANEL DE TRADES ===
  const [showTradePanel, setShowTradePanel] = useState(false);
  const [tradePanelFullscreen, setTradePanelFullscreen] = useState(false);

  // === MINIMIZAR MODAL ===
  const [minimized, setMinimized] = useState(false);

  // === PRESETS ===
  const [presets, setPresets] = useState({});
  const [selectedPreset, setSelectedPreset] = useState('');
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);

  // Actualizar zoneDays cuando cambia el interval (nuevo maxDays/defaultDays)
  useEffect(() => {
    // Si zoneDays actual excede el nuevo max, ajustar al default
    if (zoneDays > maxDays) {
      setZoneDays(defaultDays);
    }
  }, [interval, maxDays, defaultDays, zoneDays]);

  // Cargar presets del backend al montar
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/zones/presets`);
        const data = await res.json();
        if (data.success && data.presets) {
          setPresets(data.presets);
        }
      } catch (e) {
        console.error('[ZoneDetector] Error cargando presets del backend:', e);
      }
    })();
  }, []);

  // Cargar estado del servicio realtime al abrir el modal
  const fetchRealtimeStatus = useCallback(async (syncConfig = false) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/v2/status`);
      const data = await res.json();
      if (data.success) {
        setRealtimeEnabled(data.enabled || false);
        setRealtimeRunning(data.running || false);
        setDetectionPaused(false); // v2 no tiene pausa independiente
        setRealtimeStatus(data);
        // Notificar al padre sobre el estado realtime
        if (onRealtimeChange) {
          onRealtimeChange(data.running && data.config?.alerts_enabled);
        }
        // Solo actualizar inputs de config cuando se indica explicitamente
        // (al abrir el modal o despues de guardar). El polling NO sobrescribe
        // los valores que el usuario pueda estar editando.
        if (syncConfig && data.config) {
          setRealtimeWindowCandles(data.config.warmup_candles || 500);
          setRealtimeCooldown(data.config.cooldown_minutes || 5);
          setRealtimeMinScore(data.config.min_score_filter || 0);

          // Sincronizar parametros de deteccion v2 desde el backend
          const cfg = data.config;
          setParams(prev => {
            const updated = { ...prev };
            // ATR Dynamic params (v2)
            if (cfg.atr_period != null) updated.atr_dyn_period = cfg.atr_period;
            if (cfg.ma_period != null) updated.atr_dyn_ma_period = cfg.ma_period;
            if (cfg.multiplier != null) updated.atr_dyn_multiplier = cfg.multiplier;
            if (cfg.max_outside_bars != null) updated.atr_dyn_max_breakout = cfg.max_outside_bars;
            // Consolidation filters
            if (cfg.min_bars != null) updated.consol_min_bars = cfg.min_bars;
            if (cfg.max_range_pct != null) updated.consol_max_range_pct = cfg.max_range_pct;
            if (cfg.body_ratio != null) updated.consol_body_ratio = cfg.body_ratio;
            if (cfg.max_outside_count != null) updated.consol_max_outside_bars = cfg.max_outside_count;
            // TTM
            if (cfg.use_ttm != null) updated.use_ttm_prefilter = cfg.use_ttm;
            if (cfg.ttm_atr_length != null) updated.ttm_atr_length = cfg.ttm_atr_length;
            if (cfg.ttm_kc_multiplier != null) updated.ttm_kc_multiplier = cfg.ttm_kc_multiplier;
            if (cfg.ttm_min_squeeze_bars != null) updated.ttm_min_squeeze_bars = cfg.ttm_min_squeeze_bars;
            // Trade params
            if (cfg.tp_rr_ratio != null) updated.tp_rr_ratio = cfg.tp_rr_ratio;
            if (cfg.position_mode != null) updated.position_mode = cfg.position_mode;
            if (cfg.breakout_confirm_bars != null) updated.breakout_search_bars = cfg.breakout_confirm_bars;
            if (cfg.vp_bins_per_zone != null) updated.vp_bins_per_zone = cfg.vp_bins_per_zone;
            if (cfg.grace_bars != null) updated.grace_bars = cfg.grace_bars;
            return updated;
          });

          // Sincronizar sl_mode y sl_poc_buffer_pct
          if (cfg.sl_mode) setRealtimeSlMode(cfg.sl_mode);
          if (cfg.sl_poc_buffer_pct != null) setRealtimeSlPocBuffer(cfg.sl_poc_buffer_pct);

          // Sincronizar alertsEnabled y tradingBotUrl
          if (cfg.alerts_enabled != null) setAlertsEnabled(cfg.alerts_enabled);
          if (cfg.alert_target_url) {
            const baseUrl = cfg.alert_target_url.replace(/\/api\/watchlist-alert$/, '');
            if (baseUrl) setTradingBotUrl(baseUrl);
          }
        }
      }
    } catch (e) {
      console.debug('[ZoneDetector] Realtime service no disponible:', e.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Al abrir el modal, cargar config del backend para inicializar inputs
      fetchRealtimeStatus(true);
      // Polling del estado cada 10s - solo actualiza stats (zonas, alertas, uptime)
      // NO sobrescribe los inputs de config que el usuario puede estar editando
      realtimePollingRef.current = setInterval(() => fetchRealtimeStatus(false), 10000);
    }
    return () => {
      if (realtimePollingRef.current) {
        clearInterval(realtimePollingRef.current);
        realtimePollingRef.current = null;
      }
    };
  }, [isOpen, fetchRealtimeStatus]);

  // Guardar preset actual (persistido en backend)
  const handleSavePreset = useCallback(async () => {
    const name = newPresetName.trim();
    if (!name) return;

    const presetData = {
      params: { ...params },
      zoneDays,
      savedAt: new Date().toISOString()
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/presets/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presetData)
      });
      const data = await res.json();
      if (data.success) {
        setPresets(prev => ({ ...prev, [name]: presetData }));
        setSelectedPreset(name);
        setNewPresetName('');
        setShowPresetInput(false);
        console.log(`[ZoneDetector] Preset "${name}" guardado en backend`);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error guardando preset:', e);
    }
  }, [params, zoneDays, presets, newPresetName]);

  // Cargar preset seleccionado
  const handleLoadPreset = useCallback((presetName) => {
    if (!presetName || !presets[presetName]) {
      setSelectedPreset('');
      return;
    }

    const preset = presets[presetName];
    setParams(preset.params);
    if (preset.zoneDays) {
      setZoneDays(Math.min(preset.zoneDays, maxDays));
    }
    setSelectedPreset(presetName);
    console.log(`[ZoneDetector] Preset "${presetName}" cargado`);
  }, [presets, maxDays]);

  // Eliminar preset (del backend)
  const handleDeletePreset = useCallback(async (presetName) => {
    if (!presetName || !presets[presetName]) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/presets/${encodeURIComponent(presetName)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setPresets(prev => {
          const updated = { ...prev };
          delete updated[presetName];
          return updated;
        });
        if (selectedPreset === presetName) {
          setSelectedPreset('');
        }
        console.log(`[ZoneDetector] Preset "${presetName}" eliminado del backend`);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error eliminando preset:', e);
    }
  }, [presets, selectedPreset]);

  // Resetear a valores por defecto
  const handleResetToDefaults = useCallback(() => {
    setParams(defaultParams);
    setZoneDays(defaultDays);
    setSelectedPreset('');
    console.log('[ZoneDetector] Parametros reseteados a valores por defecto');
  }, [defaultDays]);

  const handleParamChange = useCallback((key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: STRING_PARAMS.includes(key) ? value
           : BOOL_PARAMS.includes(key) ? Boolean(value)
           : (typeof value === 'string' ? parseFloat(value) || 0 : value)
    }));
  }, []);

  // Obtener el manager de props o del Registry
  const getManager = useCallback(() => {
    if (indicatorManager) return indicatorManager;
    if (symbol) return IndicatorManagerRegistry.get(symbol);
    return null;
  }, [indicatorManager, symbol]);

  // Construir config V2 desde los parametros actuales del modal (mapeo frontend -> backend)
  const buildOptV2Config = useCallback(() => {
    return {
      atr_period: params.atr_dyn_period,
      ma_period: params.atr_dyn_ma_period,
      multiplier: params.atr_dyn_multiplier,
      max_outside_bars: params.atr_dyn_max_breakout,
      min_bars: params.consol_min_bars,
      max_range_pct: params.consol_max_range_pct,
      body_ratio: params.consol_body_ratio,
      max_outside_count: params.consol_max_outside_bars,
      use_ttm: params.use_ttm_prefilter,
      ttm_atr_length: params.ttm_atr_length,
      ttm_kc_multiplier: params.ttm_kc_multiplier,
      ttm_min_squeeze_bars: params.ttm_min_squeeze_bars,
      breakout_confirm_bars: typeof params.breakout_search_bars === 'number' ? params.breakout_search_bars : 3,
      tp_rr_ratio: params.tp_rr_ratio,
      sl_buffer_pct: 0.1,
      position_mode: params.position_mode || 'sequential',
      sl_mode: realtimeSlMode,
      sl_poc_buffer_pct: realtimeSlPocBuffer,
      vp_bins_per_zone: params.vp_bins_per_zone || 30,
      min_score_filter: realtimeMinScore || 0,
      grace_bars: typeof params.grace_bars === 'number' ? params.grace_bars : 2,
    };
  }, [params, realtimeSlMode, realtimeSlPocBuffer, realtimeMinScore]);

  const handleDetect = useCallback(async () => {
    const manager = getManager();
    console.log(`[ZoneDetector] handleDetect (V2): manager=${!!manager}, symbol=${symbol}, interval=${interval}, days=${zoneDays}`);
    if (!manager) {
      setError('IndicatorManager no disponible. Espera a que el grafico cargue.');
      return;
    }

    setLoading(true);
    setError(null);
    setCsvPath(null);
    setCandlesCount(null);
    setProgress({ phase: 'starting', message: 'Iniciando deteccion V2...' });

    const intervalMinutes = {1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60;
    const expectedCandles = Math.ceil((zoneDays * 24 * 60) / intervalMinutes);

    // Construir config V2 desde TODOS los parametros del modal
    const v2Config = buildOptV2Config();
    v2Config.min_score_filter = realtimeMinScore || 0;
    console.log(`[ZoneDetector] V2 config:`, JSON.stringify(v2Config));

    try {
      const startTime = Date.now();

      // Timer para mostrar tiempo transcurrido
      const timer = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        setProgress(prev => prev ? {
          ...prev,
          message: `Procesando ~${expectedCandles} velas con motor V2 (${elapsed}s)...`
        } : null);
      }, 1000);

      const result = await manager.backtestV2({ days: zoneDays, config: v2Config });

      clearInterval(timer);

      if (result.success) {
        // Convertir zonas V2 al formato del chart
        const chartZones = (result.zones || []).map((z, idx) => ({
          ...z,
          id: z.id || `v2_zone_${z.start_timestamp}_${idx}`,
        }));

        setStats(result.stats);
        setDetectedZones(chartZones);
        setCandlesCount(result.candles || null);
        setCsvPath(null);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        setProgress({ phase: 'done', message: `V2: ${chartZones.length} zonas en ${elapsed}s` });

        // Pasar zonas al visualizador
        const viz = manager.getZoneVisualizerIndicator ? manager.getZoneVisualizerIndicator() : manager.zoneVisualizerIndicator;
        if (viz) {
          viz.setZones(chartZones);
        }
        if (manager.requestRedraw) {
          manager.requestRedraw();
        }

        if (onZonesLoaded) {
          onZonesLoaded({ ...result, zones: chartZones });
        }
      } else {
        setError(result.error || 'Error detectando zonas');
        setProgress(null);
      }
    } catch (err) {
      console.error(`[ZoneDetector] ERROR V2:`, err.name, err.message, err);
      setError(err.message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [getManager, buildOptV2Config, realtimeMinScore, zoneDays, onZonesLoaded, interval, symbol]);

  // Handler de deteccion MULTI-SIMBOLO
  const handleDetectMulti = useCallback(async () => {
    if (selectedSymbols.length === 0) {
      setError('Selecciona al menos un simbolo.');
      return;
    }

    setLoading(true);
    setError(null);
    setCsvPath(null);
    setMultiResults(null);
    setStats(null);

    const intervalMinutes = {1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60;
    const expectedCandles = Math.ceil((zoneDays * 24 * 60) / intervalMinutes);
    setProgress({ phase: 'fetching', message: `Analizando ${selectedSymbols.length} simbolos (~${expectedCandles} velas c/u)...` });

    try {
      const startTime = Date.now();

      // Timer progreso
      const timer = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        setProgress(prev => prev ? {
          ...prev,
          message: `Analizando ${selectedSymbols.length} simbolos (${elapsed}s)...`
        } : null);
      }, 1000);

      const requestBody = {
        symbols: selectedSymbols,
        interval,
        days: zoneDays,
        params: { ...params },
      };

      const controller = new AbortController();
      const timeoutMs = 10 * 60 * 60 * 1000; // 10 horas para multi (400d en 1min es muy pesado)
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${API_BASE_URL}/api/zones/detect-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearInterval(timer);
      const result = await response.json();

      if (result.success) {
        setMultiResults(result);
        setStats(result.consolidated_stats);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        setProgress({ phase: 'done', message: `${selectedSymbols.length} simbolos completados en ${elapsed}s` });
      } else {
        setError(result.error || 'Error en deteccion multi-simbolo');
        setProgress(null);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Timeout: la deteccion tardo mas de 10 minutos.');
      } else {
        setError(err.message);
      }
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [selectedSymbols, params, zoneDays, interval]);

  // Toggle un simbolo en la seleccion multi
  const toggleSymbol = useCallback((sym) => {
    setSelectedSymbols(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }, []);

  // Seleccionar/deseleccionar todos
  const toggleAllSymbols = useCallback(() => {
    setSelectedSymbols(prev => prev.length === MULTI_SYMBOLS.length ? [] : [...MULTI_SYMBOLS]);
  }, []);

  // Handler de optimizacion
  // Construye enabledRanges y base_params desde el estado actual
  const buildOptParams = useCallback(() => {
    const enabledRanges = {};
    let totalCombos = 1;
    for (const [name, range] of Object.entries(optParamRanges)) {
      if (range.enabled) {
        enabledRanges[name] = { min: range.min, max: range.max, step: range.step };
        const count = Math.floor((range.max - range.min) / range.step) + 1;
        totalCombos *= Math.min(count, 20);
      }
    }
    const base = { ...params };
    for (const name of Object.keys(enabledRanges)) {
      delete base[name];
    }
    return { enabledRanges, totalCombos, base };
  }, [optParamRanges, params]);

  // Paso 1: Estimar tiempo
  const handleEstimate = useCallback(async () => {
    const manager = getManager();
    if (!manager) { setError('IndicatorManager no disponible.'); return; }

    const { enabledRanges, totalCombos } = buildOptParams();
    if (Object.keys(enabledRanges).length === 0) {
      setError('Selecciona al menos un parametro para optimizar.');
      return;
    }
    if (totalCombos > 5000) {
      setError(`Demasiadas combinaciones (~${totalCombos}). Reduce rangos o aumenta steps.`);
      return;
    }

    setOptEstimating(true);
    setOptEstimate(null);
    setError(null);

    const base = { ...params };
    for (const name of Object.keys(enabledRanges)) delete base[name];

    const result = await manager.estimateOptimization({
      days: zoneDays,
      base_params: base,
      param_ranges: enabledRanges
    });

    setOptEstimating(false);
    if (result.success) {
      setOptEstimate(result);
    } else {
      setError(`Estimacion: ${result.error || 'Error desconocido'}`);
    }
  }, [getManager, buildOptParams, params, zoneDays]);

  // Paso 2: Ejecutar optimizacion (despues de confirmar estimacion)
  const handleOptimize = useCallback(async () => {
    const manager = getManager();
    if (!manager) { setError('IndicatorManager no disponible.'); return; }

    const { enabledRanges, totalCombos, base } = buildOptParams();

    setOptRunning(true);
    setOptResults(null);
    setOptEstimate(null);
    setOptProgress({ total: totalCombos });
    setError(null);

    await manager.optimizeTradingZones({
      days: zoneDays,
      base_params: base,
      param_ranges: enabledRanges,
      metric: optMetric,
      top_n: 15,
      onComplete: (data) => {
        setOptResults(data);
        setOptRunning(false);
        setOptProgress(null);
      },
      onError: (msg) => {
        setError(`Optimizacion: ${msg}`);
        setOptRunning(false);
        setOptProgress(null);
      }
    });
  }, [getManager, buildOptParams, zoneDays, optMetric]);

  // Cancelar estimacion pendiente
  const handleCancelEstimate = useCallback(() => {
    setOptEstimate(null);
  }, []);

  // Aplicar resultado de optimizacion al panel de parametros
  const handleApplyOptResult = useCallback((resultParams) => {
    setParams(prev => ({
      ...prev,
      ...resultParams
    }));
    console.log('[ZoneDetector] Parametros optimizados aplicados:', resultParams);
  }, []);

  const handleOptRangeChange = useCallback((paramName, field, value) => {
    setOptParamRanges(prev => ({
      ...prev,
      [paramName]: {
        ...prev[paramName],
        [field]: field === 'enabled' ? value : parseFloat(value) || 0
      }
    }));
  }, []);

  // === HANDLERS OPTIMIZADOR V2 ===

  const buildOptV2Params = useCallback(() => {
    const enabledRanges = {};
    let totalCombos = 1;
    for (const [name, range] of Object.entries(optV2ParamRanges)) {
      if (range.enabled) {
        enabledRanges[name] = { min: range.min, max: range.max, step: range.step };
        const count = Math.floor((range.max - range.min) / range.step) + 1;
        totalCombos *= Math.min(count, 20);
      }
    }
    const base = buildOptV2Config();
    // Quitar del base los params que se van a optimizar
    for (const name of Object.keys(enabledRanges)) {
      delete base[name];
    }
    return { enabledRanges, totalCombos, base };
  }, [optV2ParamRanges, buildOptV2Config]);

  const handleEstimateV2 = useCallback(async () => {
    const manager = getManager();
    if (!manager) { setError('IndicatorManager no disponible.'); return; }

    const { enabledRanges, totalCombos } = buildOptV2Params();
    if (Object.keys(enabledRanges).length === 0) {
      setError('Selecciona al menos un parametro para optimizar.');
      return;
    }
    if (totalCombos > 5000) {
      setError(`Demasiadas combinaciones (~${totalCombos}). Reduce rangos o aumenta steps.`);
      return;
    }

    setOptV2Estimating(true);
    setOptV2Estimate(null);
    setError(null);

    const base = buildOptV2Config();
    for (const name of Object.keys(enabledRanges)) delete base[name];

    const result = await manager.estimateOptimizationV2({
      days: zoneDays,
      base_config: base,
      param_ranges: enabledRanges,
    });

    setOptV2Estimating(false);
    if (result.success) {
      setOptV2Estimate(result);
    } else {
      setError(`Estimacion V2: ${result.error || 'Error desconocido'}`);
    }
  }, [getManager, buildOptV2Params, buildOptV2Config, zoneDays]);

  const handleOptimizeV2 = useCallback(async () => {
    const manager = getManager();
    if (!manager) { setError('IndicatorManager no disponible.'); return; }

    const { enabledRanges, totalCombos, base } = buildOptV2Params();

    setOptV2Running(true);
    setOptV2Results(null);
    setOptV2Estimate(null);
    setError(null);

    await manager.optimizeV2({
      days: zoneDays,
      base_config: base,
      param_ranges: enabledRanges,
      metric: optV2Metric,
      top_n: 15,
      onComplete: (data) => {
        setOptV2Results(data);
        setOptV2Running(false);
      },
      onError: (msg) => {
        setError(`Optimizacion V2: ${msg}`);
        setOptV2Running(false);
      }
    });
  }, [getManager, buildOptV2Params, zoneDays, optV2Metric]);

  const handleCancelEstimateV2 = useCallback(() => {
    setOptV2Estimate(null);
  }, []);

  const handleApplyOptV2Result = useCallback(async (resultParams) => {
    console.log('[ZoneDetector] [APPLY V2] === INICIO === resultParams:', JSON.stringify(resultParams));

    // 1. Mapear nombres de backend a frontend
    const mapping = {
      multiplier: 'atr_dyn_multiplier',
      ma_period: 'atr_dyn_ma_period',
      atr_period: 'atr_dyn_period',
      max_outside_bars: 'atr_dyn_max_breakout',
      min_bars: 'consol_min_bars',
      max_range_pct: 'consol_max_range_pct',
      body_ratio: 'consol_body_ratio',
      breakout_confirm_bars: 'breakout_search_bars',
    };
    const frontendParams = {};
    for (const [bk, val] of Object.entries(resultParams)) {
      const fk = mapping[bk] || bk;
      frontendParams[fk] = val;
    }
    setParams(prev => ({ ...prev, ...frontendParams }));
    if (resultParams.sl_poc_buffer_pct != null) setRealtimeSlPocBuffer(resultParams.sl_poc_buffer_pct);

    // 2. Ejecutar backtest V2 y graficar zonas en el chart
    const manager = getManager();
    if (!manager) {
      console.error('[ZoneDetector] [APPLY V2] ERROR: manager no disponible');
      setError('IndicatorManager no disponible');
      return;
    }

    // Construir config completa con los params optimizados
    const fullConfig = { ...buildOptV2Config(), ...resultParams };
    console.log('[ZoneDetector] [APPLY V2] fullConfig:', JSON.stringify(fullConfig));
    console.log('[ZoneDetector] [APPLY V2] zoneDays:', zoneDays, 'symbol:', symbol, 'interval:', interval);

    setLoading(true);
    setError(null);
    setProgress({ phase: 'backtest_v2', message: 'Ejecutando backtest V2 con parametros aplicados...' });

    try {
      const result = await manager.backtestV2({ days: zoneDays, config: fullConfig });
      console.log('[ZoneDetector] [APPLY V2] Respuesta backtest:', {
        success: result.success,
        zonesCount: result.zones?.length || 0,
        stats: result.stats,
        error: result.error,
      });

      if (result.success && result.zones && result.zones.length > 0) {
        // Convertir zonas V2 al formato del chart
        const chartZones = result.zones.map((z, idx) => ({
          ...z,
          id: z.id || `v2_zone_${z.start_timestamp}_${idx}`,
        }));
        setDetectedZones(chartZones);
        setStats(result.stats || null);

        // Pasar zonas al visualizador directamente
        const viz = manager.getZoneVisualizerIndicator ? manager.getZoneVisualizerIndicator() : manager.zoneVisualizerIndicator;
        console.log('[ZoneDetector] [APPLY V2] Visualizador:', viz ? `OK (zones antes: ${viz.zones?.length})` : 'NULL');

        if (viz) {
          viz.setZones(chartZones);
          console.log('[ZoneDetector] [APPLY V2] setZones llamado, zones ahora:', viz.zones?.length);
        }

        // Forzar redraw directamente
        if (manager.requestRedraw) {
          manager.requestRedraw();
          console.log('[ZoneDetector] [APPLY V2] requestRedraw() ejecutado');
        }

        // Navegar al timestamp de la zona mas reciente con trade
        if (manager.navigateToTimestamp && chartZones.length > 0) {
          const zonesWithTrade = chartZones.filter(z =>
            z.trade_result && z.trade_result !== 'NO_ENTRY' && z.trade_result !== 'SKIPPED'
          );
          const targetZone = zonesWithTrade.length > 0
            ? zonesWithTrade[zonesWithTrade.length - 1]
            : chartZones[chartZones.length - 1];
          const navTs = targetZone.breakout_timestamp || targetZone.end_timestamp || targetZone.start_timestamp;
          console.log('[ZoneDetector] [APPLY V2] Navegando a zona:', {
            id: targetZone.id, trade_result: targetZone.trade_result, timestamp: navTs
          });
          manager.navigateToTimestamp(navTs);
        }

        if (onZonesLoaded) onZonesLoaded({ success: true, zones: chartZones, stats: result.stats });
        console.log(`[ZoneDetector] [APPLY V2] EXITO: ${chartZones.length} zonas graficadas`);
      } else if (result.success && (!result.zones || result.zones.length === 0)) {
        setError('Backtest V2 no produjo zonas con estos parametros y datos.');
        console.warn('[ZoneDetector] [APPLY V2] 0 zonas detectadas');
      } else {
        setError(`Backtest V2: ${result.error || 'Error desconocido'}`);
        console.error('[ZoneDetector] [APPLY V2] Error:', result.error);
      }
    } catch (err) {
      console.error('[ZoneDetector] [APPLY V2] EXCEPCION:', err);
      setError(`Backtest V2: ${err.message}`);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [getManager, buildOptV2Config, zoneDays, onZonesLoaded, symbol, interval]);

  const handleOptV2RangeChange = useCallback((paramName, field, value) => {
    setOptV2ParamRanges(prev => ({
      ...prev,
      [paramName]: {
        ...prev[paramName],
        [field]: field === 'enabled' ? value : parseFloat(value) || 0
      }
    }));
  }, []);

  const handleClear = useCallback(() => {
    const manager = getManager();
    if (manager) {
      manager.clearTradingZones();
      manager.clearZoneDetectorFixedRanges();
    }
    setStats(null);
    setDetectedZones([]);
    setVpCount(0);
    setCsvPath(null);
    setMultiResults(null);
    setProgress(null);
    setError(null);
  }, [getManager]);

  // === HANDLERS VOLUME PROFILE ===
  const handleDrawVP = useCallback((sortOrder) => {
    const manager = getManager();
    if (!manager || detectedZones.length === 0) return;

    setVpLoading(true);
    try {
      let zonesToDraw = [...detectedZones];

      if (zonesToDraw.length > VP_MAX) {
        // Ordenar por trading_score
        if (sortOrder === 'best') {
          zonesToDraw.sort((a, b) => (b.trading_score || 0) - (a.trading_score || 0));
        } else {
          zonesToDraw.sort((a, b) => (a.trading_score || 0) - (b.trading_score || 0));
        }
        zonesToDraw = zonesToDraw.slice(0, VP_MAX);
      }

      const created = manager.createZoneDetectorFixedRanges(zonesToDraw);
      setVpCount(created);
      console.log(`[ZoneDetector] VP creados: ${created} (de ${detectedZones.length} zonas, orden: ${sortOrder || 'todas'})`);
    } catch (err) {
      console.error('[ZoneDetector] Error creando VP:', err);
    } finally {
      setVpLoading(false);
    }
  }, [getManager, detectedZones]);

  const handleClearVP = useCallback(() => {
    const manager = getManager();
    if (manager) {
      manager.clearZoneDetectorFixedRanges();
      setVpCount(0);
    }
  }, [getManager]);

  const [exportingCsv, setExportingCsv] = useState(false);

  const handleExportCsv = useCallback(async () => {
    // Multi-simbolo: exportar via endpoint multi
    if (multiResults && multiResults.all_zones && multiResults.all_zones.length > 0) {
      setExportingCsv(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/zones/export-csv-multi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols: multiResults.symbols || selectedSymbols,
            interval,
            days: zoneDays,
            zones: multiResults.all_zones,
            params: { ...params }
          })
        });
        const result = await response.json();
        if (result.success) {
          setCsvPath(result.csv_path);
        } else {
          setError(result.error || 'Error exportando CSV multi');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setExportingCsv(false);
      }
      return;
    }

    // Single-simbolo: exportar via IndicatorManager
    const manager = getManager();
    if (!manager) return;

    setExportingCsv(true);
    try {
      const result = await manager.exportZonesCsv({
        symbol,
        interval,
        days: zoneDays,
        detectionParams: params
      });
      if (result.success) {
        setCsvPath(result.csv_path);
      } else {
        setError(result.error || 'Error exportando CSV');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingCsv(false);
    }
  }, [getManager, symbol, interval, zoneDays, params, multiResults, selectedSymbols]);

  // === HANDLER ALERTAS ===
  const handleToggleAlerts = useCallback((enabled) => {
    setAlertsEnabled(enabled);
    try { localStorage.setItem('zoneDetector_alertsEnabled', String(enabled)); } catch {}
  }, []);

  const handleTradingBotUrlChange = useCallback((url) => {
    setTradingBotUrl(url);
    try { localStorage.setItem('zoneDetector_tradingBotUrl', url); } catch {}
  }, []);

  const handleOrderTypeChange = useCallback((type) => {
    setAlertOrderType(type);
    try { localStorage.setItem('zoneDetector_alertOrderType', type); } catch {}
  }, []);

  const handleSendAlerts = useCallback(async () => {
    const manager = getManager();
    if (!manager || detectedZones.length === 0) return;

    setAlertSending(true);
    setAlertResult(null);
    try {
      const result = await manager.sendZoneAlertsBatch(
        detectedZones,
        params.entry_mode || 'breakout_close',
        tradingBotUrl,
        alertOrderType
      );
      setAlertResult(result);
      console.log(`[ZoneDetector] Alertas enviadas:`, result);
    } catch (err) {
      setAlertResult({ success: false, error: err.message });
    } finally {
      setAlertSending(false);
    }
  }, [getManager, detectedZones, params.entry_mode, tradingBotUrl, alertOrderType]);

  // === HANDLERS REALTIME SERVICE ===
  const handleRealtimeToggle = useCallback(async () => {
    setRealtimeLoading(true);
    try {
      const starting = !realtimeRunning;
      const endpoint = realtimeRunning
        ? `${API_BASE_URL}/api/zones/v2/stop`
        : `${API_BASE_URL}/api/zones/v2/start`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRealtimeRunning(starting);
        setRealtimeEnabled(starting);
        // Sincronizar config despues de start/stop
        await fetchRealtimeStatus(true);

        // Iniciar/detener polling de zonas en el chart
        const manager = getManager();
        if (manager) {
          if (starting) {
            manager.startRealtimeZonePolling();
          } else {
            manager.stopRealtimeZonePolling();
          }
        }
      } else {
        console.error('[ZoneDetector] Error toggling v2:', data.error);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error toggling v2:', e);
    } finally {
      setRealtimeLoading(false);
    }
  }, [realtimeRunning, fetchRealtimeStatus, getManager]);

  const handleToggleDetectionPause = useCallback(async () => {
    // v2: no tiene pausa separada, no-op
  }, []);

  const [detectNowLoading, setDetectNowLoading] = useState(false);

  const handleDetectNow = useCallback(async () => {
    setDetectNowLoading(true);
    try {
      // v2: reset re-carga warmup y reinicia detectores
      const res = await fetch(`${API_BASE_URL}/api/zones/v2/reset`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log('[ZoneDetector] v2 reset OK');
        // Refrescar zonas en el grafico
        try {
          const zonesRes = await fetch(`${API_BASE_URL}/api/zones/v2/zones/${symbol}`);
          const zonesData = await zonesRes.json();
          if (zonesData.success && zonesData.zones && onZonesLoaded) {
            onZonesLoaded(zonesData.zones);
          }
        } catch (e) { /* ignore */ }
        await fetchRealtimeStatus();
      }
    } catch (e) {
      console.error('[ZoneDetector] Error en v2 reset:', e);
    }
    setDetectNowLoading(false);
  }, [symbol, onZonesLoaded, fetchRealtimeStatus]);

  const handleRealtimeConfigSave = useCallback(async () => {
    setRealtimeLoading(true);
    setRealtimeConfigMsg(null);
    try {
      // Mapear params del modal a formato v2 config
      const configPayload = {
        enabled: true,
        symbols: [symbol],
        interval: interval,
        // ATR Dynamic params
        atr_period: params.atr_dyn_period || 100,
        ma_period: params.atr_dyn_ma_period || 20,
        multiplier: params.atr_dyn_multiplier || 1.5,
        max_outside_bars: params.atr_dyn_max_breakout || 5,
        // Consolidation filters
        min_bars: params.consol_min_bars || 8,
        max_range_pct: params.consol_max_range_pct || 6.0,
        body_ratio: params.consol_body_ratio || 0.7,
        max_outside_count: params.consol_max_outside_bars || 3,
        // TTM
        use_ttm: !!params.use_ttm_prefilter,
        ttm_atr_length: params.ttm_atr_length || 30,
        ttm_kc_multiplier: params.ttm_kc_multiplier || 1.0,
        ttm_min_squeeze_bars: params.ttm_min_squeeze_bars || 10,
        // Trade
        breakout_confirm_bars: typeof params.breakout_search_bars === 'number' ? params.breakout_search_bars : 3,
        tp_rr_ratio: params.tp_rr_ratio || 1.0,
        position_mode: params.position_mode || 'sequential',
        sl_mode: realtimeSlMode || 'zone_opposite',
        sl_poc_buffer_pct: realtimeSlPocBuffer || 50,
        vp_bins_per_zone: params.vp_bins_per_zone || 30,
        // Alertas
        alerts_enabled: alertsEnabled,
        alert_target_url: `${tradingBotUrl}/api/watchlist-alert`,
        cooldown_minutes: realtimeCooldown,
        // Warmup
        warmup_candles: realtimeWindowCandles,
        // Score filter
        min_score_filter: realtimeMinScore || 0,
        // Grace bars
        grace_bars: typeof params.grace_bars === 'number' ? params.grace_bars : 2,
      };

      const res = await fetch(`${API_BASE_URL}/api/zones/v2/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configPayload)
      });
      const data = await res.json();
      if (data.success) {
        const updated = data.updated || [];
        console.log('[ZoneDetector] Realtime config guardada:', updated);
        // Sincronizar config desde backend para confirmar que se guardo correctamente
        await fetchRealtimeStatus(true);
        const restarted = data.status?.running && updated.some(k => ['interval', 'symbols', 'window_candles'].includes(k));
        setRealtimeConfigMsg({
          type: 'ok',
          text: updated.length > 0
            ? `Config aplicada (${updated.length} cambios)${restarted ? ' - servicio reiniciado' : ''}`
            : 'Sin cambios (los valores ya eran iguales)'
        });
        // Auto-ocultar mensaje despues de 5s
        setTimeout(() => setRealtimeConfigMsg(null), 5000);
      } else {
        setRealtimeConfigMsg({ type: 'error', text: data.error || 'Error guardando config' });
        console.error('[ZoneDetector] Error guardando config realtime:', data.error);
      }
    } catch (e) {
      setRealtimeConfigMsg({ type: 'error', text: e.message });
      console.error('[ZoneDetector] Error guardando config realtime:', e);
    } finally {
      setRealtimeLoading(false);
    }
  }, [symbol, interval, realtimeWindowCandles, realtimeCooldown, realtimeMinScore,
      alertsEnabled, tradingBotUrl, params, fetchRealtimeStatus, realtimeSlMode, realtimeSlPocBuffer]);

  const handleRealtimeClearCooldowns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/v2/clear-cooldowns`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log('[ZoneDetector] v2 cooldowns limpiados');
        await fetchRealtimeStatus(false);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error limpiando cooldowns v2:', e);
    }
  }, [fetchRealtimeStatus]);

  const handleRealtimeReanalyze = useCallback(async () => {
    setRealtimeLoading(true);
    try {
      // v2: reset recarga warmup y reinicia detectores
      const res = await fetch(`${API_BASE_URL}/api/zones/v2/reset`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log('[ZoneDetector] v2 reset completado');
        await fetchRealtimeStatus(false);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error reseteando v2:', e);
    } finally {
      setRealtimeLoading(false);
    }
  }, [fetchRealtimeStatus]);

  // === COMPUTAR DATOS DE TRADES PARA EL PANEL ===
  const tradeTableData = useMemo(() => {
    // Obtener zonas segun modo (single o multi)
    const zones = multiResults && multiResults.all_zones
      ? multiResults.all_zones
      : detectedZones;

    if (!zones || zones.length === 0) return [];

    // Filtrar solo trades ejecutados (WIN o LOSS) y ordenar cronologicamente
    const executed = zones
      .filter(z => z.trade_result === 'WIN' || z.trade_result === 'LOSS')
      .sort((a, b) => (a.entry_timestamp || a.breakout_timestamp || 0) - (b.entry_timestamp || b.breakout_timestamp || 0));

    if (executed.length === 0) return [];

    let cumulativeProfit = 0;
    let peakProfit = 0;
    let cumulativeDrawdown = 0;
    let totalWinR = 0;
    let totalLossR = 0;

    return executed.map((z, i) => {
      const pnlR = z.trade_pnl_r || 0;
      cumulativeProfit += pnlR;

      if (cumulativeProfit > peakProfit) {
        peakProfit = cumulativeProfit;
      }
      cumulativeDrawdown = peakProfit - cumulativeProfit;

      if (pnlR > 0) totalWinR += pnlR;
      else totalLossR += Math.abs(pnlR);

      const profitFactor = totalLossR > 0 ? (totalWinR / totalLossR) : (totalWinR > 0 ? Infinity : 0);

      // Fechas
      const entryTs = z.entry_timestamp || z.breakout_timestamp || z.end_timestamp || 0;
      const closeTs = z.trade_close_timestamp || 0;

      const fmtDate = (ts) => {
        if (!ts) return '--';
        const d = new Date(ts);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(2);
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dd}/${mm}/${yy} ${hh}:${min}`;
      };

      return {
        num: z.timeline_index || (i + 1),
        tradeNum: i + 1,
        symbol: z.symbol || symbol || '',
        entryDate: fmtDate(entryTs),
        closeDate: fmtDate(closeTs),
        result: z.trade_result,
        pnlR: pnlR,
        cumulativeProfit: Math.round(cumulativeProfit * 100) / 100,
        drawdown: Math.round(cumulativeDrawdown * 100) / 100,
        profitFactor: profitFactor === Infinity ? '++' : (profitFactor === 0 ? '0.00' : profitFactor.toFixed(2)),
        direction: z.breakout_direction || '',
        score: z.trading_score || 0,
        zoneStartTs: z.start_timestamp || 0,
        entryTs: entryTs,
      };
    });
  }, [detectedZones, multiResults, symbol]);

  // Handler: click en trade navega el grafico a esa zona
  const handleTradeClick = useCallback((trade) => {
    const ts = trade.zoneStartTs || trade.entryTs;
    if (!ts) return;
    const manager = IndicatorManagerRegistry.get(trade.symbol || symbol);
    if (manager && manager.navigateToTimestamp) {
      manager.navigateToTimestamp(ts);
    }
  }, [symbol]);

  // Cuando el modal esta cerrado, mantener el componente montado pero oculto
  // para preservar el estado de params, zonas detectadas, etc.
  if (!isOpen) return <div style={{ display: 'none' }} />;

  // --- Render del panel de trades (drawer lateral) ---
  const renderTradePanel = () => {
    if (!showTradePanel) return null;
    const data = tradeTableData;
    const isFullscreen = tradePanelFullscreen;

    // Equity curve data
    const equityPoints = [{x: 0, y: 0}];
    data.forEach((t, i) => {
      equityPoints.push({x: i + 1, y: t.cumulativeProfit});
    });

    // SVG dimensions
    const svgW = isFullscreen ? 900 : 420;
    const svgH = isFullscreen ? 220 : 130;
    const pad = {top: 15, right: 30, bottom: 25, left: 45};
    const plotW = svgW - pad.left - pad.right;
    const plotH = svgH - pad.top - pad.bottom;

    const yVals = equityPoints.map(p => p.y);
    const yMin = Math.min(0, ...yVals);
    const yMax = Math.max(0, ...yVals);
    const yRange = (yMax - yMin) || 1;
    const xMax = equityPoints.length - 1 || 1;

    const toSvgX = (x) => pad.left + (x / xMax) * plotW;
    const toSvgY = (y) => pad.top + plotH - ((y - yMin) / yRange) * plotH;

    const pathD = equityPoints.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`
    ).join(' ');

    // Area fill (bajo la curva hasta 0)
    const zeroY = toSvgY(0);
    const areaD = pathD + ` L${toSvgX(xMax).toFixed(1)},${zeroY.toFixed(1)} L${toSvgX(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

    // Grid lines (y)
    const yGridCount = 5;
    const yGridStep = yRange / yGridCount;
    const yGridLines = [];
    for (let i = 0; i <= yGridCount; i++) {
      const val = yMin + i * yGridStep;
      yGridLines.push({y: toSvgY(val), label: val.toFixed(1)});
    }

    const lastEquity = data.length > 0 ? data[data.length - 1].cumulativeProfit : 0;
    const equityColor = lastEquity >= 0 ? '#4CAF50' : '#FF5722';

    const panelStyle = isFullscreen ? {
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: '#FAFAFA',
      zIndex: 1100,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    } : {
      position: 'fixed',
      top: '50%',
      right: '20px',
      transform: 'translateY(-50%)',
      width: '480px',
      maxHeight: '90vh',
      backgroundColor: '#FAFAFA',
      borderRadius: '8px',
      boxShadow: '0 4px 30px rgba(0,0,0,0.15)',
      border: '1px solid #D0D0D0',
      zIndex: 1050,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    };

    // Colores light mode para la tabla
    const lt = {
      headerBg: '#E8EAF0',
      rowEven: '#FFFFFF',
      rowOdd: '#F5F6F8',
      rowBorder: '#E0E0E0',
      textPrimary: '#333333',
      textSecondary: '#666666',
      textMuted: '#999999',
      thColor: '#555555',
      thBorder: '#CCC',
      green: '#2E7D32',
      red: '#C62828',
      yellow: '#E65100',
      svgBg: '#FFFFFF',
      svgGrid: '#E8E8E8',
      svgZero: '#BBBBBB',
      svgAxisText: '#888888',
      summaryBg: '#EEF0F4',
      summaryText: '#555555',
      summaryValue: '#222222',
    };

    return (
      <div style={panelStyle}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderBottom: '1px solid #D0D0D0', backgroundColor: lt.headerBg,
          flexShrink: 0
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span style={{fontSize: '14px', fontWeight: 'bold', color: lt.textPrimary}}>
              Trades ({data.length})
            </span>
            <span style={{
              fontSize: '13px', fontWeight: 'bold',
              color: lastEquity >= 0 ? lt.green : lt.red
            }}>
              {lastEquity >= 0 ? '+' : ''}{lastEquity.toFixed(2)}R
            </span>
          </div>
          <div style={{display: 'flex', gap: '6px'}}>
            <button
              style={{
                background: 'none', border: '1px solid #BBB', borderRadius: '4px',
                color: lt.textSecondary, cursor: 'pointer', padding: '3px 8px', fontSize: '12px'
              }}
              onClick={() => setTradePanelFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Salir de fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '⊟' : '⊞'}
            </button>
            <button
              style={{
                background: 'none', border: 'none',
                color: '#999', cursor: 'pointer', fontSize: '20px', padding: '0 4px'
              }}
              onClick={() => { setShowTradePanel(false); setTradePanelFullscreen(false); }}
            >
              x
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{flex: 1, overflow: 'auto', padding: '10px 14px'}}>
          {data.length === 0 ? (
            <div style={{textAlign: 'center', padding: '30px', color: lt.textMuted, fontSize: '13px'}}>
              No hay trades ejecutados (WIN/LOSS).
              <br/>Ejecuta una deteccion primero.
            </div>
          ) : (
            <>
              {/* Equity Curve */}
              <div style={{marginBottom: '12px'}}>
                <div style={{fontSize: '11px', color: lt.textSecondary, marginBottom: '4px'}}>Equity Curve</div>
                <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{
                  backgroundColor: lt.svgBg, borderRadius: '4px', border: '1px solid #D0D0D0'
                }}>
                  {/* Grid lines */}
                  {yGridLines.map((g, i) => (
                    <g key={i}>
                      <line x1={pad.left} y1={g.y} x2={svgW - pad.right} y2={g.y}
                        stroke={lt.svgGrid} strokeWidth="0.5" />
                      <text x={pad.left - 4} y={g.y + 3} textAnchor="end"
                        fill={lt.svgAxisText} fontSize="9">{g.label}R</text>
                    </g>
                  ))}
                  {/* Zero line */}
                  <line x1={pad.left} y1={zeroY} x2={svgW - pad.right} y2={zeroY}
                    stroke={lt.svgZero} strokeWidth="0.8" strokeDasharray="3,3" />
                  {/* Area fill */}
                  <path d={areaD} fill={equityColor} opacity="0.12" />
                  {/* Equity line */}
                  <path d={pathD} fill="none" stroke={equityColor} strokeWidth="1.8" />
                  {/* Dots on key points */}
                  {equityPoints.length <= 60 && equityPoints.map((p, i) => (
                    i > 0 && <circle key={i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r="2.5"
                      fill={p.y >= 0 ? lt.green : lt.red} />
                  ))}
                  {/* X axis labels */}
                  <text x={pad.left} y={svgH - 4} fill={lt.svgAxisText} fontSize="8">1</text>
                  <text x={svgW - pad.right} y={svgH - 4} textAnchor="end" fill={lt.svgAxisText} fontSize="8">{data.length}</text>
                  <text x={(pad.left + svgW - pad.right) / 2} y={svgH - 4} textAnchor="middle" fill={lt.svgZero} fontSize="8">Trade #</text>
                </svg>
              </div>

              {/* Tabla de trades */}
              <div style={{
                border: '1px solid #D0D0D0', borderRadius: '4px',
                maxHeight: isFullscreen ? 'calc(100vh - 300px)' : '350px',
                overflowY: 'auto'
              }}>
                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '10px'}}>
                  <thead>
                    <tr style={{backgroundColor: lt.headerBg, position: 'sticky', top: 0, zIndex: 2}}>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>#</th>
                      {multiResults && <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Sym</th>}
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Entrada</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Cierre</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Dir</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Res</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>PnL (R)</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>Profit</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>DD</th>
                      <th style={{...styles.th, color: lt.thColor, borderBottom: `1px solid ${lt.thBorder}`}}>PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((t, i) => (
                      <tr key={i} onClick={() => handleTradeClick(t)} style={{
                        backgroundColor: i % 2 === 0 ? lt.rowEven : lt.rowOdd,
                        borderBottom: `1px solid ${lt.rowBorder}`,
                        cursor: 'pointer'
                      }}>
                        <td style={{...styles.td, color: lt.textMuted}}>{t.num}</td>
                        {multiResults && (
                          <td style={{...styles.td, fontSize: '9px', color: lt.textSecondary}}>
                            {t.symbol.replace('USDT', '')}
                          </td>
                        )}
                        <td style={{...styles.td, fontSize: '9px', color: lt.textSecondary}}>{t.entryDate}</td>
                        <td style={{...styles.td, fontSize: '9px', color: lt.textSecondary}}>{t.closeDate}</td>
                        <td style={{
                          ...styles.td,
                          color: t.direction === 'UP' ? lt.green : lt.red,
                          fontSize: '9px'
                        }}>
                          {t.direction === 'UP' ? 'L' : 'S'}
                        </td>
                        <td style={{
                          ...styles.td, fontWeight: 'bold',
                          color: t.result === 'WIN' ? lt.green : lt.red
                        }}>
                          {t.result === 'WIN' ? 'W' : 'L'}
                        </td>
                        <td style={{
                          ...styles.td, fontWeight: 'bold',
                          color: t.pnlR >= 0 ? lt.green : lt.red
                        }}>
                          {t.pnlR >= 0 ? '+' : ''}{t.pnlR.toFixed(2)}
                        </td>
                        <td style={{
                          ...styles.td, fontWeight: 'bold',
                          color: t.cumulativeProfit >= 0 ? lt.green : lt.red
                        }}>
                          {t.cumulativeProfit >= 0 ? '+' : ''}{t.cumulativeProfit.toFixed(2)}
                        </td>
                        <td style={{
                          ...styles.td,
                          color: t.drawdown > 0 ? lt.red : lt.textMuted
                        }}>
                          {t.drawdown > 0 ? `-${t.drawdown.toFixed(2)}` : '0'}
                        </td>
                        <td style={{
                          ...styles.td,
                          color: t.profitFactor === '++' ? lt.green
                            : parseFloat(t.profitFactor) >= 1.5 ? lt.green
                            : parseFloat(t.profitFactor) >= 1 ? lt.yellow
                            : lt.red
                        }}>
                          {t.profitFactor}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Resumen al pie */}
              <div style={{
                display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap',
                marginTop: '10px', padding: '8px',
                backgroundColor: lt.summaryBg, borderRadius: '4px',
                fontSize: '11px', color: lt.summaryText
              }}>
                <span>Trades: <strong style={{color: lt.summaryValue}}>{data.length}</strong></span>
                <span>WR: <strong style={{color: lt.summaryValue}}>
                  {(data.filter(t => t.result === 'WIN').length / data.length * 100).toFixed(1)}%
                </strong></span>
                <span>PnL: <strong style={{color: lastEquity >= 0 ? lt.green : lt.red}}>
                  {lastEquity >= 0 ? '+' : ''}{lastEquity.toFixed(2)}R
                </strong></span>
                <span>Max DD: <strong style={{color: lt.red}}>
                  -{Math.max(...data.map(t => t.drawdown)).toFixed(2)}R
                </strong></span>
                <span>PF: <strong style={{color: lt.summaryValue}}>
                  {data.length > 0 ? data[data.length - 1].profitFactor : '--'}
                </strong></span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // --- Render minimizado: barra flotante ---
  if (minimized) {
    return (
      <>
        {renderTradePanel()}
        <div style={{
          position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#1E1E2E', borderRadius: '8px', padding: '8px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '1px solid #444',
          zIndex: 1000, display: 'flex', alignItems: 'center', gap: '12px',
          cursor: 'default', userSelect: 'none'
        }}>
          <span style={{fontSize: '13px', color: '#E0E0E0', fontWeight: 'bold'}}>
            Detector de Zonas
          </span>
          {stats && (
            <span style={{fontSize: '11px', color: '#B0B0B0'}}>
              {stats.total_zones || 0} zonas | WR {stats.win_rate?.toFixed(0) || 0}% | PnL {stats.total_pnl_r > 0 ? '+' : ''}{stats.total_pnl_r?.toFixed(1) || 0}R
            </span>
          )}
          <button
            style={{
              padding: '3px 10px', borderRadius: '4px', border: '1px solid #4A6FA5',
              backgroundColor: 'transparent', color: '#4A6FA5', fontSize: '12px',
              cursor: 'pointer', fontWeight: 'bold'
            }}
            onClick={() => setMinimized(false)}
          >
            Abrir
          </button>
          <button
            style={{
              background: 'none', border: 'none', color: '#888',
              cursor: 'pointer', fontSize: '16px', padding: '0 2px'
            }}
            onClick={onClose}
            title="Cerrar"
          >
            x
          </button>
        </div>
      </>
    );
  }

  return (
    <div style={styles.overlay}>
      {renderTradePanel()}
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>Detector de Zonas</h3>
          <div style={{display: 'flex', gap: '4px', alignItems: 'center'}}>
            <button
              style={{
                background: 'none', border: '1px solid #555', borderRadius: '4px',
                color: '#888', cursor: 'pointer', padding: '2px 8px', fontSize: '13px'
              }}
              onClick={() => setMinimized(true)}
              title="Minimizar"
            >
              _
            </button>
            <button style={styles.closeBtn} onClick={onClose}>x</button>
          </div>
        </div>

        <div style={styles.content}>
          {/* === PRESETS === */}
          <div style={styles.presetsSection}>
            <div style={styles.presetsRow}>
              <select
                style={styles.presetSelect}
                value={selectedPreset}
                onChange={(e) => handleLoadPreset(e.target.value)}
              >
                <option value="">-- Preset --</option>
                {Object.keys(presets).sort().map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>

              {selectedPreset && (
                <button
                  style={styles.presetDeleteBtn}
                  onClick={() => handleDeletePreset(selectedPreset)}
                  title="Eliminar preset"
                >
                  🗑️
                </button>
              )}

              <button
                style={styles.presetResetBtn}
                onClick={handleResetToDefaults}
                title="Resetear a valores por defecto"
              >
                ↺
              </button>

              {!showPresetInput ? (
                <button
                  style={styles.presetSaveBtn}
                  onClick={() => setShowPresetInput(true)}
                  title="Guardar como preset"
                >
                  💾 Guardar
                </button>
              ) : (
                <div style={styles.presetInputRow}>
                  <input
                    type="text"
                    style={styles.presetNameInput}
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePreset();
                      if (e.key === 'Escape') setShowPresetInput(false);
                    }}
                    placeholder="Nombre del preset"
                    autoFocus
                  />
                  <button
                    style={styles.presetConfirmBtn}
                    onClick={handleSavePreset}
                    disabled={!newPresetName.trim()}
                  >
                    ✓
                  </button>
                  <button
                    style={styles.presetCancelBtn}
                    onClick={() => {
                      setShowPresetInput(false);
                      setNewPresetName('');
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            {Object.keys(presets).length > 0 && (
              <div style={styles.presetCount}>
                {Object.keys(presets).length} preset{Object.keys(presets).length !== 1 ? 's' : ''} guardado{Object.keys(presets).length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          {/* Metodo de Deteccion */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Metodo de Deteccion</h4>
            <div style={styles.row}>
              <label style={styles.label}>Algoritmo:</label>
              <select
                style={{...styles.input, width: '180px'}}
                value={params.detection_method}
                onChange={(e) => handleParamChange('detection_method', e.target.value)}
              >
                <option value="trading_zones">Consolidacion (actual)</option>
                <option value="atr_dynamic">ATR Dinamico (Range Detector)</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '4px'}}>
              {params.detection_method === 'trading_zones'
                ? 'Detecta rangos por body ratio y ATR ratio de velas'
                : 'Usa SMA +/- ATR como limites dinamicos (como Range Detector)'}
            </div>
          </div>

          {/* Periodo de analisis */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Periodo de Analisis</h4>
            <div style={styles.row}>
              <label style={styles.label}>Dias a analizar:</label>
              <input
                type="number"
                style={{...styles.input, width: '80px'}}
                value={zoneDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1;
                  setZoneDays(Math.min(Math.max(v, 1), maxDays));
                }}
                min="1"
                max={maxDays}
              />
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '2px'}}>
              ~{Math.ceil((zoneDays * 24 * 60) / ({1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60))} velas
              {' '}(max {maxDays} dias para {interval}m)
            </div>
          </div>

          {/* Parametros de consolidacion - solo si metodo es trading_zones */}
          {params.detection_method === 'trading_zones' && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>Parametros de Consolidacion</h4>

              <div style={styles.row}>
                <label style={styles.label}>Min Barras:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.consol_min_bars}
                  onChange={(e) => handleParamChange('consol_min_bars', parseInt(e.target.value))}
                  min="3"
                  max="30"
                />
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Max Barras:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.consol_max_bars}
                  onChange={(e) => handleParamChange('consol_max_bars', parseInt(e.target.value))}
                  min="10"
                  max="200"
                />
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Max Rango %:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.consol_max_range_pct}
                  onChange={(e) => handleParamChange('consol_max_range_pct', e.target.value)}
                  step="0.1"
                  min="0.5"
                  max="10"
                />
              </div>

              <div style={styles.row}>
                <label style={styles.label}>ATR Ratio:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.consol_atr_ratio}
                  onChange={(e) => handleParamChange('consol_atr_ratio', e.target.value)}
                  step="0.1"
                  min="0.1"
                  max="2"
                />
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Body Ratio:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.consol_body_ratio}
                  onChange={(e) => handleParamChange('consol_body_ratio', e.target.value)}
                  step="0.1"
                  min="0.1"
                  max="1"
                />
              </div>
            </div>
          )}

          {/* Parametros ATR Dynamic - solo si metodo es atr_dynamic */}
          {params.detection_method === 'atr_dynamic' && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>Parametros ATR Dinamico</h4>
              <div style={{fontSize: '11px', color: '#777', marginBottom: '8px'}}>
                Algoritmo basado en LuxAlgo Range Detector. Usa SMA +/- ATR como limites dinamicos.
              </div>

              <div style={styles.row}>
                <label style={styles.label}>ATR Periodo:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.atr_dyn_period}
                  onChange={(e) => handleParamChange('atr_dyn_period', parseInt(e.target.value))}
                  min="50"
                  max="500"
                />
              </div>
              <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '4px'}}>
                Periodo largo para volatilidad de fondo (default: 200)
              </div>

              <div style={styles.row}>
                <label style={styles.label}>SMA Periodo:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.atr_dyn_ma_period}
                  onChange={(e) => handleParamChange('atr_dyn_ma_period', parseInt(e.target.value))}
                  min="5"
                  max="100"
                />
              </div>
              <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '4px'}}>
                Periodo de la media movil central (default: 20)
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Min Bars (zona):</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.atr_dyn_min_bars}
                  onChange={(e) => handleParamChange('atr_dyn_min_bars', parseInt(e.target.value))}
                  min="0"
                  max="200"
                />
              </div>
              <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '4px'}}>
                Minimo de velas en la zona. 0 = usar SMA Periodo (default: 0)
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Multiplicador:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.atr_dyn_multiplier}
                  onChange={(e) => handleParamChange('atr_dyn_multiplier', e.target.value)}
                  step="0.1"
                  min="0.5"
                  max="3.0"
                />
              </div>
              <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '4px'}}>
                Ancho de banda: SMA +/- ATR*mult (default: 1.0)
              </div>

              <div style={styles.row}>
                <label style={styles.label}>Max Breakout:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.atr_dyn_max_breakout}
                  onChange={(e) => handleParamChange('atr_dyn_max_breakout', parseInt(e.target.value))}
                  min="1"
                  max="15"
                />
              </div>
              <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '4px'}}>
                Velas fuera permitidas antes de romper (re-entry tolerance)
              </div>

              <div style={styles.row}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.atr_dyn_merge_overlap}
                    onChange={(e) => handleParamChange('atr_dyn_merge_overlap', e.target.checked)}
                  />
                  <span>Mergear rangos solapados</span>
                </label>
              </div>
            </div>
          )}

          {/* Capas v3.0 opcionales */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Capas Opcionales v3.0</h4>

            {/* Capa 1: Banda ATR Dinamica */}
            <div style={styles.layerBlock}>
              <div style={styles.layerHeader}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.use_atr_band}
                    onChange={(e) => handleParamChange('use_atr_band', e.target.checked)}
                  />
                  <span style={styles.layerName}>Banda ATR Dinamica</span>
                </label>
              </div>
              {params.use_atr_band && (
                <div style={styles.layerContent}>
                  <div style={{fontSize: '11px', color: '#777', marginBottom: '6px'}}>
                    Reemplaza high/low absoluto con SMA +/- ATR*mult
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>ATR Periodo:</label>
                    <input type="number" style={styles.input} value={params.atr_band_period}
                      onChange={(e) => handleParamChange('atr_band_period', parseInt(e.target.value))}
                      min="50" max="500" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Multiplicador:</label>
                    <input type="number" style={styles.input} value={params.atr_band_multiplier}
                      onChange={(e) => handleParamChange('atr_band_multiplier', e.target.value)}
                      step="0.1" min="0.5" max="3.0" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>SMA Periodo:</label>
                    <input type="number" style={styles.input} value={params.atr_band_ma_period}
                      onChange={(e) => handleParamChange('atr_band_ma_period', parseInt(e.target.value))}
                      min="5" max="100" />
                  </div>
                  <div style={{fontSize: '10px', color: '#666', marginTop: '2px'}}>
                    Ignora: Max Rango %, ATR Ratio, Body Ratio
                  </div>
                </div>
              )}
            </div>

            {/* Capa 2: Re-ingreso Tolerante */}
            <div style={styles.layerBlock}>
              <div style={styles.layerHeader}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.use_reentry}
                    onChange={(e) => handleParamChange('use_reentry', e.target.checked)}
                  />
                  <span style={styles.layerName}>Re-ingreso Tolerante</span>
                </label>
              </div>
              {params.use_reentry && (
                <div style={styles.layerContent}>
                  <div style={{fontSize: '11px', color: '#777', marginBottom: '6px'}}>
                    Permite velas fuera sin romper la zona
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Max Barras Fuera:</label>
                    <input type="number" style={styles.input} value={params.max_reentry_bars}
                      onChange={(e) => handleParamChange('max_reentry_bars', parseInt(e.target.value))}
                      min="1" max="10" />
                  </div>
                  <div style={{fontSize: '10px', color: '#666', marginTop: '2px'}}>
                    Reemplaza el parametro "Max Outside Bars" clasico
                  </div>
                </div>
              )}
            </div>

            {/* Capa 3: TTM Squeeze Pre-Filtro */}
            <div style={styles.layerBlock}>
              <div style={styles.layerHeader}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.use_ttm_prefilter}
                    onChange={(e) => handleParamChange('use_ttm_prefilter', e.target.checked)}
                  />
                  <span style={styles.layerName}>TTM Squeeze Pre-Filtro</span>
                </label>
              </div>
              {params.use_ttm_prefilter && (
                <div style={styles.layerContent}>
                  <div style={{fontSize: '11px', color: '#777', marginBottom: '6px'}}>
                    Solo busca zonas donde BB esta dentro de KC
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>ATR Length:</label>
                    <input type="number" style={styles.input} value={params.ttm_atr_length}
                      onChange={(e) => handleParamChange('ttm_atr_length', parseInt(e.target.value))}
                      min="5" max="50" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>KC Multiplicador:</label>
                    <input type="number" style={styles.input} value={params.ttm_kc_multiplier}
                      onChange={(e) => handleParamChange('ttm_kc_multiplier', e.target.value)}
                      step="0.1" min="0.5" max="3.0" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Min Barras Squeeze:</label>
                    <input type="number" style={styles.input} value={params.ttm_min_squeeze_bars}
                      onChange={(e) => handleParamChange('ttm_min_squeeze_bars', parseInt(e.target.value))}
                      min="2" max="20" />
                  </div>
                </div>
              )}
            </div>

            {/* Capa 4: BBWP Scoring */}
            <div style={styles.layerBlock}>
              <div style={styles.layerHeader}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.use_bbwp_scoring}
                    onChange={(e) => handleParamChange('use_bbwp_scoring', e.target.checked)}
                  />
                  <span style={styles.layerName}>BBWP Scoring</span>
                </label>
              </div>
              {params.use_bbwp_scoring && (
                <div style={styles.layerContent}>
                  <div style={{fontSize: '11px', color: '#777', marginBottom: '6px'}}>
                    Bonus al score si BBWP bajo (volatilidad comprimida)
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Lookback:</label>
                    <input type="number" style={styles.input} value={params.bbwp_lookback}
                      onChange={(e) => handleParamChange('bbwp_lookback', parseInt(e.target.value))}
                      min="50" max="500" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Threshold %:</label>
                    <input type="number" style={styles.input} value={params.bbwp_squeeze_threshold}
                      onChange={(e) => handleParamChange('bbwp_squeeze_threshold', parseInt(e.target.value))}
                      min="5" max="80" />
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Historial dias:</label>
                    <input type="number" style={styles.input} value={params.bbwp_history_days || 0}
                      onChange={(e) => handleParamChange('bbwp_history_days', parseInt(e.target.value))}
                      min="0" max="30" />
                  </div>
                  {(params.bbwp_history_days || 0) > 0 && (
                    <div style={{fontSize: '10px', color: '#4fc3f7', marginTop: '2px'}}>
                      Cargara {params.bbwp_history_days}d de velas para BBWP, detecta zonas solo en los dias seleccionados
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Capa 5: % Velas Dentro */}
            <div style={styles.layerBlock}>
              <div style={styles.layerHeader}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={params.use_inside_pct_filter}
                    onChange={(e) => handleParamChange('use_inside_pct_filter', e.target.checked)}
                  />
                  <span style={styles.layerName}>% Velas Dentro</span>
                </label>
              </div>
              {params.use_inside_pct_filter && (
                <div style={styles.layerContent}>
                  <div style={{fontSize: '11px', color: '#777', marginBottom: '6px'}}>
                    Descarta zonas con muchas velas fuera del rango
                  </div>
                  <div style={styles.row}>
                    <label style={styles.label}>Min % Dentro:</label>
                    <input type="number" style={styles.input} value={params.min_inside_pct}
                      onChange={(e) => handleParamChange('min_inside_pct', e.target.value)}
                      step="5" min="50" max="100" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Parametros de simulacion */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Simulacion de Trade</h4>

            <div style={styles.row}>
              <label style={styles.label}>Modo de Entrada:</label>
              <select
                style={{...styles.input, width: '150px', textAlign: 'left'}}
                value={params.entry_mode}
                onChange={(e) => handleParamChange('entry_mode', e.target.value)}
              >
                <option value="breakout_close">Close del Breakout</option>
                <option value="va_breakout">VA Breakout (Volume Profile)</option>
                <option value="swing_confirmation">Swing Confirmation</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              {params.entry_mode === 'breakout_close'
                ? 'Entrada al precio de cierre de la vela que rompe la zona'
                : params.entry_mode === 'va_breakout'
                ? 'Entrada al cierre de la vela que rompe el Value Area (70% vol). SL basado en POC'
                : 'Entrada al confirmarse el swing (pullback) post-breakout'}
            </div>

            {params.entry_mode === 'va_breakout' && (
              <>
                <div style={{fontSize: '11px', color: '#4A90E2', marginBottom: '8px', padding: '6px 8px', background: 'rgba(74,144,226,0.08)', borderRadius: '4px', lineHeight: '1.4'}}>
                  El breakout se detecta cuando el precio cierra fuera del Value Area (donde esta el 70% del volumen), no de la zona completa. El SL se calcula desde la distancia Entry -&gt; POC + buffer %.
                </div>
                <div style={styles.row}>
                  <label style={styles.label}>SL Buffer % (sobre POC):</label>
                  <input
                    type="number"
                    style={{...styles.input, width: '70px'}}
                    value={params.sl_poc_buffer_pct}
                    onChange={(e) => handleParamChange('sl_poc_buffer_pct', parseFloat(e.target.value))}
                    min="0"
                    max="200"
                    step="10"
                  />
                  <span style={{fontSize: '11px', color: '#888', marginLeft: '6px'}}>%</span>
                </div>
                <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
                  50% = SL a 1.5x la distancia entry&rarr;POC. 100% = SL a 2x.
                </div>
                <div style={styles.row}>
                  <label style={styles.label}>VP Bins por zona:</label>
                  <input
                    type="number"
                    style={{...styles.input, width: '70px'}}
                    value={params.vp_bins_per_zone}
                    onChange={(e) => handleParamChange('vp_bins_per_zone', parseInt(e.target.value))}
                    min="10"
                    max="100"
                    step="5"
                  />
                </div>
                <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
                  Resolucion del Volume Profile (mas bins = mas detalle, 30 recomendado)
                </div>
              </>
            )}

            {params.entry_mode === 'swing_confirmation' && (
              <>
                <div style={styles.row}>
                  <label style={styles.label}>Swing Bars:</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={params.swing_bars}
                    onChange={(e) => handleParamChange('swing_bars', parseInt(e.target.value))}
                    min="2"
                    max="10"
                  />
                </div>
                <div style={styles.row}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={params.use_continuation_score}
                      onChange={(e) => handleParamChange('use_continuation_score', e.target.checked)}
                    />
                    <span style={{fontSize: '12px', color: '#A0A0A0'}}>Incluir continuation en score</span>
                  </label>
                </div>
                <div style={{fontSize: '10px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
                  Suma puntos por velas consecutivas post-breakout (solo aplica en swing confirmation)
                </div>
              </>
            )}

            <div style={styles.row}>
              <label style={styles.label}>Modo de Posicion:</label>
              <select
                style={{...styles.input, width: '150px', textAlign: 'left'}}
                value={params.position_mode}
                onChange={(e) => handleParamChange('position_mode', e.target.value)}
              >
                <option value="sequential">Sequential (1 a la vez)</option>
                <option value="concurrent">Concurrent (simultaneas)</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              {params.position_mode === 'sequential'
                ? 'Solo un trade abierto a la vez (realista)'
                : 'Multiples trades simultaneos'}
            </div>

            {params.entry_mode !== 'va_breakout' && (
              <>
                <div style={styles.row}>
                  <label style={styles.label}>Modo de StopLoss:</label>
                  <select
                    style={{...styles.input, width: '150px', textAlign: 'left'}}
                    value={params.sl_mode}
                    onChange={(e) => handleParamChange('sl_mode', e.target.value)}
                  >
                    <option value="zone_opposite">Lado opuesto del rango</option>
                    <option value="swing_previous">Swing H/L anterior</option>
                  </select>
                </div>
                <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
                  {params.sl_mode === 'zone_opposite'
                    ? 'SL a 1R del entry (R = altura del rango)'
                    : 'SL al swing high/low anterior al breakout'}
                </div>
              </>
            )}

            <div style={styles.row}>
              <label style={styles.label}>Lookforward Bars:</label>
              <input
                type="number"
                style={styles.input}
                value={params.lookforward_bars}
                onChange={(e) => handleParamChange('lookforward_bars', parseInt(e.target.value))}
                min="20"
                max="500"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Max Price Range %:</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_price_range_pct}
                onChange={(e) => handleParamChange('max_price_range_pct', e.target.value)}
                step="0.5"
                min="1"
                max="20"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>TP Risk:Reward:</label>
              <input
                type="number"
                style={styles.input}
                value={params.tp_rr_ratio}
                onChange={(e) => handleParamChange('tp_rr_ratio', e.target.value)}
                step="0.5"
                min="0.5"
                max="10"
              />
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              Take Profit = {params.tp_rr_ratio}x el riesgo (R). SL siempre = 1R.
            </div>

            {/* Filtro de Score Minimo */}
            <div style={{...styles.row, marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333'}}>
              <label style={styles.label}>Score Minimo:</label>
              <input
                type="range"
                style={{...styles.input, width: '120px'}}
                value={params.min_score_filter}
                onChange={(e) => handleParamChange('min_score_filter', parseInt(e.target.value))}
                min="0"
                max="80"
                step="5"
              />
              <span style={{marginLeft: '8px', fontSize: '12px', color: params.min_score_filter > 0 ? '#4CAF50' : '#888'}}>
                {params.min_score_filter > 0 ? `${params.min_score_filter}%` : 'Sin filtro'}
              </span>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              Descarta zonas con score menor (0 = sin filtro). Recomendado: 50-65%
            </div>
          </div>

          {/* === MULTI-SIMBOLO === */}
          <div style={{marginBottom: '12px', padding: '10px', backgroundColor: '#1A1A2E', borderRadius: '6px', border: '1px solid #333'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: multiMode ? '8px' : 0}}>
              <label style={{fontSize: '12px', color: '#B0B0B0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'}}>
                <input
                  type="checkbox"
                  checked={multiMode}
                  onChange={(e) => { setMultiMode(e.target.checked); setMultiResults(null); }}
                  style={{margin: 0, cursor: 'pointer'}}
                />
                Multi-simbolo
              </label>
              {!multiMode && (
                <span style={{fontSize: '11px', color: '#666'}}>
                  Analizar solo {symbol}
                </span>
              )}
              {multiMode && selectedSymbols.length > 0 && (
                <span style={{fontSize: '11px', color: '#4A6FA5'}}>
                  {selectedSymbols.length} seleccionados
                </span>
              )}
            </div>

            {multiMode && (
              <>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px'}}>
                  <span style={{fontSize: '11px', color: '#888'}}>Selecciona simbolos para analizar:</span>
                  <button
                    onClick={toggleAllSymbols}
                    style={{fontSize: '10px', color: '#4A6FA5', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px'}}
                  >
                    {selectedSymbols.length === MULTI_SYMBOLS.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </button>
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '100px', overflowY: 'auto'}}>
                  {MULTI_SYMBOLS.map(sym => {
                    const isSelected = selectedSymbols.includes(sym);
                    const isCurrent = sym === symbol;
                    return (
                      <button
                        key={sym}
                        onClick={() => toggleSymbol(sym)}
                        style={{
                          fontSize: '10px',
                          padding: '3px 7px',
                          borderRadius: '3px',
                          border: isSelected ? '1px solid #4A6FA5' : '1px solid #444',
                          backgroundColor: isSelected ? '#2A3A5E' : '#222',
                          color: isSelected ? '#B0C4FF' : '#888',
                          cursor: 'pointer',
                          fontWeight: isCurrent ? 'bold' : 'normal',
                          textDecoration: isCurrent ? 'underline' : 'none',
                        }}
                      >
                        {sym.replace('USDT', '')}
                      </button>
                    );
                  })}
                </div>
                <div style={{fontSize: '10px', color: '#555', marginTop: '4px'}}>
                  Mismos parametros aplicados a todos. Genera CSV consolidado.
                </div>
              </>
            )}
          </div>

          {/* Botones de accion */}
          <div style={styles.actions}>
            <button
              style={styles.detectBtn}
              onClick={multiMode ? handleDetectMulti : handleDetect}
              disabled={loading || (multiMode && selectedSymbols.length === 0)}
            >
              {loading
                ? 'Detectando...'
                : multiMode
                  ? `Detectar (${selectedSymbols.length} simbolos)`
                  : 'Detectar Zonas'}
            </button>
            <button
              style={styles.clearBtn}
              onClick={handleClear}
            >
              Limpiar
            </button>
          </div>

          {/* Progreso */}
          {progress && (
            <div style={styles.progressBar}>
              <div style={{fontSize: '12px', color: '#B0B0B0', marginBottom: '4px'}}>
                {progress.message}
              </div>
              {loading && (
                <div style={{height: '3px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden'}}>
                  <div style={{
                    height: '100%',
                    backgroundColor: '#4A6FA5',
                    borderRadius: '2px',
                    width: progress.phase === 'done' ? '100%' : '60%',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={styles.error}>
              ❌ {error}
            </div>
          )}

          {/* Estadísticas */}
          {stats && (
            <div style={styles.stats}>
              <h4 style={styles.sectionTitle}>
                {multiResults ? `Resultados Consolidados (${multiResults.symbol_results?.length || 0} simbolos)` : 'Resultados'}
              </h4>
              {!multiResults && candlesCount && (
                <div style={{fontSize: '11px', color: '#888', marginBottom: '4px'}}>
                  {candlesCount.toLocaleString()} velas analizadas ({zoneDays} dias, {interval}m)
                </div>
              )}
              {multiResults && (
                <div style={{fontSize: '11px', color: '#888', marginBottom: '4px'}}>
                  {multiResults.symbol_results?.filter(r => r.success).length}/{multiResults.symbol_results?.length} simbolos OK
                  {' | '}{zoneDays} dias, {interval}m
                  {multiResults.elapsed_seconds && ` | ${multiResults.elapsed_seconds}s`}
                </div>
              )}
              {!multiResults && stats.entry_mode && (
                <div style={{fontSize: '11px', color: '#666', marginBottom: '8px'}}>
                  Entrada: {stats.entry_mode === 'breakout_close' ? 'Close Breakout' : stats.entry_mode === 'va_breakout' ? 'VA Breakout (VP)' : 'Swing Confirmation'}
                  {' | '}Pos: {stats.position_mode === 'sequential' ? 'Sequential' : 'Concurrent'}
                </div>
              )}
              <div style={styles.statsGrid}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Total Zonas:</span>
                  <span style={styles.statValue}>{stats.total_zones}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Win Rate:</span>
                  <span style={{...styles.statValue, color: stats.win_rate >= 50 ? '#4CAF50' : '#FF5722'}}>
                    {stats.win_rate}%
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Wins:</span>
                  <span style={{...styles.statValue, color: '#4CAF50'}}>{stats.wins}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Losses:</span>
                  <span style={{...styles.statValue, color: '#FF5722'}}>{stats.losses}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>P&L Total:</span>
                  <span style={{...styles.statValue, color: stats.total_pnl_r >= 0 ? '#4CAF50' : '#FF5722'}}>
                    {stats.total_pnl_r > 0 ? '+' : ''}{stats.total_pnl_r}R
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Expectancy:</span>
                  <span style={{...styles.statValue, color: (stats.expectancy || 0) >= 0 ? '#4CAF50' : '#FF5722'}}>
                    {(stats.expectancy || 0) > 0 ? '+' : ''}{(stats.expectancy || 0).toFixed(3)}R
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Open:</span>
                  <span style={{...styles.statValue, color: '#FFC107'}}>{stats.open}</span>
                </div>
                {(stats.skipped > 0 || stats.no_entry > 0) && (
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>Skipped / No Entry:</span>
                    <span style={{...styles.statValue, color: '#888'}}>
                      {stats.skipped || 0} / {stats.no_entry || 0}
                    </span>
                  </div>
                )}
                {/* Nuevas metricas de rachas */}
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Max Wins Seguidos:</span>
                  <span style={{...styles.statValue, color: '#4CAF50'}}>
                    {stats.max_consecutive_wins || 0}
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Max Losses Seguidos:</span>
                  <span style={{...styles.statValue, color: '#FF5722'}}>
                    {stats.max_consecutive_losses || 0}
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Max Drawdown:</span>
                  <span style={{...styles.statValue, color: '#FF5722'}}>
                    -{stats.max_drawdown_r || 0}R
                  </span>
                </div>
                {stats.profit_factor != null && (
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>Profit Factor:</span>
                    <span style={{...styles.statValue, color: stats.profit_factor >= 1 ? '#4CAF50' : '#FF5722'}}>
                      {stats.profit_factor >= 999 ? 'Inf' : stats.profit_factor}
                    </span>
                  </div>
                )}
              </div>

              {/* Desglose por simbolo (solo multi-modo) */}
              {multiResults && multiResults.symbol_results && (
                <div style={{marginTop: '10px', borderTop: '1px solid #333', paddingTop: '8px'}}>
                  <div style={{fontSize: '11px', color: '#888', marginBottom: '6px', fontWeight: 'bold'}}>Desglose por simbolo:</div>
                  <div style={{maxHeight: '180px', overflowY: 'auto'}}>
                    <table style={{width: '100%', fontSize: '10px', borderCollapse: 'collapse'}}>
                      <thead>
                        <tr style={{color: '#888', borderBottom: '1px solid #333'}}>
                          <th style={{textAlign: 'left', padding: '3px 4px'}}>Simbolo</th>
                          <th style={{textAlign: 'center', padding: '3px 4px'}}>Zonas</th>
                          <th style={{textAlign: 'center', padding: '3px 4px'}}>W/L</th>
                          <th style={{textAlign: 'center', padding: '3px 4px'}}>WR%</th>
                          <th style={{textAlign: 'right', padding: '3px 4px'}}>P&L(R)</th>
                          <th style={{textAlign: 'right', padding: '3px 4px'}}>Exp.</th>
                          <th style={{textAlign: 'right', padding: '3px 4px'}}>PF</th>
                          <th style={{textAlign: 'right', padding: '3px 4px'}}>MDD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {multiResults.symbol_results.map((r, idx) => {
                          if (!r.success) return (
                            <tr key={idx} style={{color: '#FF5722', borderBottom: '1px solid #222'}}>
                              <td style={{padding: '3px 4px'}}>{r.symbol?.replace('USDT','')}</td>
                              <td colSpan={7} style={{padding: '3px 4px', textAlign: 'center'}}>Error: {r.error}</td>
                            </tr>
                          );
                          const s = r.stats || {};
                          const pnlColor = (s.total_pnl_r || 0) >= 0 ? '#4CAF50' : '#FF5722';
                          const wrColor = (s.win_rate || 0) >= 50 ? '#4CAF50' : '#FF5722';
                          return (
                            <tr key={idx} style={{borderBottom: '1px solid #222'}}>
                              <td style={{padding: '3px 4px', color: '#B0B0B0', fontWeight: 'bold'}}>{r.symbol?.replace('USDT','')}</td>
                              <td style={{padding: '3px 4px', textAlign: 'center', color: '#888'}}>{s.total_zones || 0}</td>
                              <td style={{padding: '3px 4px', textAlign: 'center', color: '#888'}}>{s.wins || 0}/{s.losses || 0}</td>
                              <td style={{padding: '3px 4px', textAlign: 'center', color: wrColor}}>{s.win_rate || 0}%</td>
                              <td style={{padding: '3px 4px', textAlign: 'right', color: pnlColor}}>
                                {(s.total_pnl_r || 0) > 0 ? '+' : ''}{s.total_pnl_r || 0}R
                              </td>
                              <td style={{padding: '3px 4px', textAlign: 'right', color: (s.expectancy || 0) >= 0 ? '#4CAF50' : '#FF5722'}}>
                                {(s.expectancy || 0).toFixed(2)}
                              </td>
                              <td style={{padding: '3px 4px', textAlign: 'right', color: (s.profit_factor || 0) >= 1 ? '#4CAF50' : '#FF5722'}}>
                                {(s.profit_factor || 0) >= 999 ? 'Inf' : (s.profit_factor || 0)}
                              </td>
                              <td style={{padding: '3px 4px', textAlign: 'right', color: '#FF5722'}}>
                                -{s.max_drawdown_r || 0}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Volume Profile en Zonas (solo visible despues de detectar) */}
          {stats && detectedZones.length > 0 && (
            <div style={styles.vpSection}>
              <h4 style={styles.sectionTitle}>Volume Profile en Zonas</h4>
              <div style={{fontSize: '11px', color: '#888', marginBottom: '8px'}}>
                Dibuja Volume Profile Fixed Range en cada zona detectada para analizar la distribucion de volumen.
                {detectedZones.length > VP_MAX && (
                  <span style={{color: '#FFC107'}}> Hay {detectedZones.length} zonas (max {VP_MAX}).</span>
                )}
              </div>

              {detectedZones.length <= VP_MAX ? (
                /* Caso simple: <= 50 zonas, dibujar todas */
                <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
                  <button
                    style={styles.vpBtn}
                    onClick={() => handleDrawVP('all')}
                    disabled={vpLoading}
                  >
                    {vpLoading ? 'Dibujando...' : `Dibujar VP (${detectedZones.length} zonas)`}
                  </button>
                  {vpCount > 0 && (
                    <button style={styles.vpClearBtn} onClick={handleClearVP}>
                      Limpiar VP ({vpCount})
                    </button>
                  )}
                </div>
              ) : (
                /* Caso >50 zonas: selector mejor/peor score */
                <div>
                  <div style={{fontSize: '11px', color: '#B0B0B0', marginBottom: '6px'}}>
                    Selecciona cuales {VP_MAX} zonas dibujar:
                  </div>
                  <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
                    <button
                      style={styles.vpBtn}
                      onClick={() => handleDrawVP('best')}
                      disabled={vpLoading}
                    >
                      {vpLoading ? 'Dibujando...' : `Mejores ${VP_MAX} (mayor score)`}
                    </button>
                    <button
                      style={{...styles.vpBtn, backgroundColor: '#5D4037'}}
                      onClick={() => handleDrawVP('worst')}
                      disabled={vpLoading}
                    >
                      {vpLoading ? 'Dibujando...' : `Peores ${VP_MAX} (menor score)`}
                    </button>
                  </div>
                  {vpCount > 0 && (
                    <button style={{...styles.vpClearBtn, marginTop: '6px'}} onClick={handleClearVP}>
                      Limpiar VP ({vpCount})
                    </button>
                  )}
                </div>
              )}

              {vpCount > 0 && (
                <div style={{fontSize: '11px', color: '#4CAF50', marginTop: '6px'}}>
                  {vpCount} Volume Profiles dibujados
                </div>
              )}
            </div>
          )}

          {/* Exportar CSV + Ver Trades (visible despues de detectar) */}
          {stats && (
            <div style={{marginBottom: '12px'}}>
              <div style={{display: 'flex', gap: '8px', marginBottom: '6px'}}>
                <button
                  style={styles.csvBtn}
                  onClick={handleExportCsv}
                  disabled={exportingCsv}
                >
                  {exportingCsv ? 'Exportando...' : multiResults ? 'Exportar CSV Consolidado' : 'Exportar CSV'}
                </button>
                <button
                  style={{...styles.csvBtn, backgroundColor: '#1565C0'}}
                  onClick={() => setShowTradePanel(true)}
                >
                  Ver Trades
                </button>
              </div>
              {csvPath && (
                <div style={styles.csvInfo}>
                  CSV {multiResults ? 'consolidado' : ''} guardado: <code style={styles.code}>{csvPath}</code>
                </div>
              )}
            </div>
          )}

          {/* === OPTIMIZADOR DE PARAMETROS === */}
          <div style={styles.optimizerSection}>
            <div
              style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: showOptimizer ? '8px' : 0}}
              onClick={() => setShowOptimizer(!showOptimizer)}
            >
              <h4 style={{...styles.sectionTitle, marginBottom: 0}}>
                Optimizador de Parametros
              </h4>
              <span style={{fontSize: '12px', color: '#888'}}>{showOptimizer ? '▲' : '▼'}</span>
            </div>

            {showOptimizer && (
              <>
                <div style={{fontSize: '11px', color: '#888', marginBottom: '10px'}}>
                  Grid search sobre rangos de parametros. Descarga velas 1 vez y prueba todas las combinaciones.
                </div>

                {/* Metrica objetivo */}
                <div style={{...styles.row, marginBottom: '10px'}}>
                  <label style={styles.label}>Optimizar para:</label>
                  <select
                    style={{...styles.input, width: '130px', textAlign: 'left'}}
                    value={optMetric}
                    onChange={(e) => setOptMetric(e.target.value)}
                  >
                    <option value="expectancy">Expectancy (R)</option>
                    <option value="total_pnl_r">P&L Total (R)</option>
                    <option value="win_rate">Win Rate (%)</option>
                    <option value="profit_factor">Profit Factor</option>
                  </select>
                </div>

                {/* Tabla de parametros */}
                <div style={{marginBottom: '10px'}}>
                  <div style={{display: 'grid', gridTemplateColumns: '24px 1fr 55px 55px 55px', gap: '4px', alignItems: 'center', marginBottom: '4px'}}>
                    <span style={{fontSize: '10px', color: '#666'}}></span>
                    <span style={{fontSize: '10px', color: '#666'}}>Parametro</span>
                    <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Min</span>
                    <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Max</span>
                    <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Step</span>
                  </div>

                  {Object.entries(optParamRanges).map(([name, range]) => {
                    const labels = {
                      atr_dyn_multiplier: 'ATR Multiplier',
                      atr_dyn_ma_period: 'MA Period',
                      atr_dyn_max_breakout: 'Max Breakout',
                      consol_max_range_pct: 'Max Range %',
                      min_score_filter: 'Min Score',
                      lookforward_bars: 'Lookforward',
                      atr_dyn_period: 'ATR Period',
                      ttm_atr_length: 'TTM ATR Length',
                      ttm_kc_multiplier: 'TTM KC Mult',
                      ttm_min_squeeze_bars: 'TTM Min Bars',
                      tp_rr_ratio: 'TP R:R Ratio',
                    };
                    const count = Math.min(Math.floor((range.max - range.min) / range.step) + 1, 20);
                    return (
                      <div key={name} style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 1fr 55px 55px 55px',
                        gap: '4px',
                        alignItems: 'center',
                        marginBottom: '3px',
                        opacity: range.enabled ? 1 : 0.5
                      }}>
                        <input
                          type="checkbox"
                          checked={range.enabled}
                          onChange={(e) => handleOptRangeChange(name, 'enabled', e.target.checked)}
                          style={{margin: 0, cursor: 'pointer'}}
                        />
                        <span style={{fontSize: '11px', color: range.enabled ? '#B0B0B0' : '#666'}}>
                          {labels[name] || name}
                          {range.enabled && <span style={{color: '#555', marginLeft: '4px'}}>({count})</span>}
                        </span>
                        <input
                          type="number"
                          style={{...styles.optInput}}
                          value={range.min}
                          onChange={(e) => handleOptRangeChange(name, 'min', e.target.value)}
                          disabled={!range.enabled}
                        />
                        <input
                          type="number"
                          style={{...styles.optInput}}
                          value={range.max}
                          onChange={(e) => handleOptRangeChange(name, 'max', e.target.value)}
                          disabled={!range.enabled}
                        />
                        <input
                          type="number"
                          style={{...styles.optInput}}
                          value={range.step}
                          onChange={(e) => handleOptRangeChange(name, 'step', e.target.value)}
                          disabled={!range.enabled}
                          step="any"
                        />
                      </div>
                    );
                  })}

                  {/* Total combinaciones */}
                  {(() => {
                    let total = 1;
                    let enabledCount = 0;
                    for (const range of Object.values(optParamRanges)) {
                      if (range.enabled) {
                        enabledCount++;
                        total *= Math.min(Math.floor((range.max - range.min) / range.step) + 1, 20);
                      }
                    }
                    return (
                      <div style={{fontSize: '11px', color: total > 5000 ? '#FF5722' : total > 500 ? '#FFC107' : '#4CAF50', marginTop: '6px'}}>
                        {enabledCount > 0
                          ? `${total.toLocaleString()} combinaciones (${enabledCount} parametros)`
                          : 'Selecciona al menos un parametro'
                        }
                        {total > 5000 && ' — Max: 5000'}
                      </div>
                    );
                  })()}
                </div>

                {/* Boton estimar / ejecutar */}
                {!optEstimate && !optRunning && (
                  <button
                    style={{
                      ...styles.detectBtn,
                      backgroundColor: optEstimating ? '#555' : '#6A1B9A',
                      marginBottom: '10px',
                      width: '100%'
                    }}
                    onClick={handleEstimate}
                    disabled={optEstimating || optRunning || loading}
                  >
                    {optEstimating ? 'Estimando tiempo...' : 'Estimar y Ejecutar'}
                  </button>
                )}

                {/* Resultado de estimacion con confirmar/cancelar */}
                {optEstimate && !optRunning && (
                  <div style={{marginBottom: '10px', padding: '10px', backgroundColor: '#1A1A2E', borderRadius: '6px', border: '1px solid #6A1B9A'}}>
                    <div style={{fontSize: '12px', color: '#CE93D8', fontWeight: 'bold', marginBottom: '8px'}}>
                      Estimacion de tiempo
                    </div>
                    <div style={{fontSize: '11px', color: '#E0E0E0', lineHeight: '1.6'}}>
                      <div>Combinaciones: <strong>{optEstimate.total_combos}</strong></div>
                      <div>Velas: <strong>{optEstimate.candles?.toLocaleString()}</strong></div>
                      <div>Tiempo por combo: <strong>{optEstimate.avg_per_combo}s</strong></div>
                      <div style={{marginTop: '4px', fontSize: '13px', color: optEstimate.estimated_seconds > 300 ? '#FF8A80' : optEstimate.estimated_seconds > 60 ? '#FFD54F' : '#A5D6A7'}}>
                        Tiempo estimado: <strong>
                          {optEstimate.estimated_seconds < 60
                            ? `${optEstimate.estimated_seconds.toFixed(0)} segundos`
                            : optEstimate.estimated_seconds < 3600
                              ? `${Math.floor(optEstimate.estimated_seconds / 60)} min ${Math.round(optEstimate.estimated_seconds % 60)}s`
                              : `${Math.floor(optEstimate.estimated_seconds / 3600)}h ${Math.round((optEstimate.estimated_seconds % 3600) / 60)} min`
                          }
                        </strong>
                      </div>
                    </div>
                    <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                      <button
                        style={{...styles.detectBtn, backgroundColor: '#6A1B9A', flex: 1}}
                        onClick={handleOptimize}
                      >
                        Confirmar y Ejecutar
                      </button>
                      <button
                        style={{...styles.detectBtn, backgroundColor: '#444', flex: 0.6}}
                        onClick={handleCancelEstimate}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Indicador de progreso durante ejecucion */}
                {optRunning && (
                  <div style={{marginBottom: '10px', textAlign: 'center'}}>
                    <div style={{fontSize: '11px', color: '#CE93D8', marginBottom: '6px'}}>
                      Procesando {optProgress?.total || '?'} combinaciones en el backend...
                    </div>
                    <div style={{height: '4px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden', position: 'relative'}}>
                      <div
                        ref={el => {
                          if (el && !el.dataset.animated) {
                            el.dataset.animated = '1';
                            const style = document.createElement('style');
                            style.textContent = '@keyframes optBarSlide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}';
                            document.head.appendChild(style);
                          }
                        }}
                        style={{
                          height: '100%',
                          width: '40%',
                          backgroundColor: '#7B1FA2',
                          borderRadius: '2px',
                          position: 'absolute',
                          animation: 'optBarSlide 1.5s ease-in-out infinite'
                        }}
                      />
                    </div>
                    <div style={{fontSize: '10px', color: '#888', marginTop: '4px'}}>
                      Revisa los logs del backend para ver el progreso.
                    </div>
                  </div>
                )}

                {/* Resultados */}
                {optResults && optResults.results && optResults.results.length > 0 && (
                  <div style={{marginBottom: '10px'}}>
                    <div style={{fontSize: '11px', color: '#B0B0B0', marginBottom: '6px'}}>
                      Top {optResults.results.length} de {optResults.total_combos} combinaciones ({optResults.elapsed}s)
                      {' — Ordenado por '}<strong style={{color: '#CE93D8'}}>{optResults.metric}</strong>
                    </div>

                    <div style={{maxHeight: '250px', overflowY: 'auto', border: '1px solid #333', borderRadius: '4px'}}>
                      <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '10px'}}>
                        <thead>
                          <tr style={{backgroundColor: '#252536', position: 'sticky', top: 0}}>
                            <th style={styles.th}>#</th>
                            <th style={styles.th}>Params</th>
                            <th style={styles.th}>WR%</th>
                            <th style={styles.th}>W/L</th>
                            <th style={styles.th}>PnL</th>
                            <th style={styles.th}>Expect</th>
                            <th style={styles.th}>PF</th>
                            <th style={styles.th}>DD</th>
                            <th style={styles.th}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {optResults.results.map((r, i) => (
                            <tr key={i} style={{
                              backgroundColor: i === 0 ? 'rgba(106, 27, 154, 0.15)' : (i % 2 === 0 ? '#1E1E2E' : '#252536'),
                              borderBottom: '1px solid #333'
                            }}>
                              <td style={{...styles.td, color: i === 0 ? '#CE93D8' : '#888', fontWeight: i === 0 ? 'bold' : 'normal'}}>
                                {i + 1}
                              </td>
                              <td style={{...styles.td, textAlign: 'left', maxWidth: '120px'}}>
                                {Object.entries(r.params).map(([k, v]) => (
                                  <div key={k} style={{whiteSpace: 'nowrap'}}>
                                    <span style={{color: '#888'}}>{k.replace('atr_dyn_', '').replace('consol_', '')}:</span>{' '}
                                    <span style={{color: '#E0E0E0'}}>{typeof v === 'number' ? (v % 1 ? v.toFixed(2) : v) : v}</span>
                                  </div>
                                ))}
                              </td>
                              <td style={{...styles.td, color: r.win_rate >= 50 ? '#4CAF50' : '#FF5722'}}>{r.win_rate}%</td>
                              <td style={styles.td}>{r.wins}/{r.losses}</td>
                              <td style={{...styles.td, color: r.total_pnl_r >= 0 ? '#4CAF50' : '#FF5722'}}>
                                {r.total_pnl_r > 0 ? '+' : ''}{r.total_pnl_r}R
                              </td>
                              <td style={{...styles.td, color: r.expectancy >= 0 ? '#4CAF50' : '#FF5722'}}>
                                {r.expectancy > 0 ? '+' : ''}{r.expectancy}
                              </td>
                              <td style={{...styles.td, color: r.profit_factor >= 1.5 ? '#4CAF50' : r.profit_factor >= 1 ? '#FFC107' : '#FF5722'}}>
                                {r.profit_factor}
                              </td>
                              <td style={{...styles.td, color: '#FF5722'}}>-{r.max_drawdown_r}R</td>
                              <td style={styles.td}>
                                <button
                                  style={styles.applyBtn}
                                  onClick={() => handleApplyOptResult(r.params)}
                                  title="Aplicar estos parametros"
                                >
                                  Aplicar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {optResults && optResults.results && optResults.results.length === 0 && (
                  <div style={{fontSize: '11px', color: '#FF5722', marginBottom: '10px'}}>
                    No se encontraron resultados validos. Intenta con rangos diferentes.
                  </div>
                )}
              </>
            )}
          </div>

          {/* === DETECCION EN TIEMPO REAL === */}
          <div style={styles.realtimeSection}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
              <h4 style={{...styles.sectionTitle, marginBottom: 0}}>
                Deteccion Realtime
              </h4>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: realtimeRunning ? '#4CAF50' : '#666',
                  boxShadow: realtimeRunning ? '0 0 6px #4CAF50' : 'none'
                }} />
                <span style={{fontSize: '11px', color: realtimeRunning ? '#4CAF50' : '#888'}}>
                  {realtimeRunning ? 'Corriendo' : 'Detenido'}
                </span>
              </div>
            </div>

            <div style={{fontSize: '11px', color: '#888', marginBottom: '8px'}}>
              Monitorea velas en tiempo real para detectar consolidaciones y breakouts automaticamente.
              Los parametros de deteccion se sincronizan con los de arriba.
            </div>

            {/* Controles realtime */}
            <div style={styles.row}>
              <label style={styles.label}>Body Ratio:</label>
              <input
                type="number"
                style={{...styles.input, width: '60px'}}
                value={params.consol_body_ratio}
                onChange={(e) => handleParamChange('consol_body_ratio', parseFloat(e.target.value) || 0.7)}
                step="0.1"
                min="0.1"
                max="1"
              />
              <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>max cuerpo/rango</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Ventana (velas):</label>
              <input
                type="number"
                style={{...styles.input, width: '80px'}}
                value={realtimeWindowCandles}
                onChange={(e) => setRealtimeWindowCandles(Math.max(5, Math.min(5000, parseInt(e.target.value) || 500)))}
                min={5}
                max={5000}
              />
              <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>
                {realtimeWindowCandles >= 1440 ? `~${Math.round(realtimeWindowCandles / 1440)}d en 1m` : `~${Math.round(realtimeWindowCandles / 288)}d en 5m`}
              </span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Cooldown (min):</label>
              <input
                type="number"
                style={{...styles.input, width: '60px'}}
                value={realtimeCooldown}
                onChange={(e) => setRealtimeCooldown(Math.max(1, Math.min(1440, parseInt(e.target.value) || 30)))}
                min={1}
                max={1440}
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Score minimo:</label>
              <input
                type="number"
                style={{...styles.input, width: '60px'}}
                value={realtimeMinScore}
                onChange={(e) => setRealtimeMinScore(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                min={0}
                max={100}
              />
              <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>0 = sin filtro</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Grace Bars:</label>
              <input
                type="number"
                style={{...styles.input, width: '60px'}}
                value={params.grace_bars}
                onChange={(e) => handleParamChange('grace_bars', Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
                min={0}
                max={10}
              />
              <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>velas de tolerancia (0 = estricto)</span>
            </div>

            {/* SL Mode */}
            <div style={styles.row}>
              <label style={styles.label}>SL Mode:</label>
              <select
                style={{...styles.input, width: '140px'}}
                value={realtimeSlMode}
                onChange={(e) => setRealtimeSlMode(e.target.value)}
              >
                <option value="zone_opposite">Zone Opposite</option>
                <option value="va_poc">POC (Volume Profile)</option>
              </select>
            </div>

            {realtimeSlMode === 'va_poc' && (
              <div style={styles.row}>
                <label style={styles.label}>POC Buffer %:</label>
                <input
                  type="number"
                  style={{...styles.input, width: '60px'}}
                  value={realtimeSlPocBuffer}
                  onChange={(e) => setRealtimeSlPocBuffer(Math.max(0, Math.min(200, parseFloat(e.target.value) || 50)))}
                  step="5"
                  min={0}
                  max={200}
                />
                <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>buffer sobre dist entry-POC</span>
              </div>
            )}

            <div style={styles.row}>
              <label style={styles.label}>Confirm Bars:</label>
              <input
                type="number"
                style={{...styles.input, width: '60px'}}
                value={typeof params.breakout_search_bars === 'number' ? params.breakout_search_bars : 3}
                onChange={(e) => handleParamChange('breakout_search_bars', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                min={1}
                max={10}
              />
              <span style={{fontSize: '10px', color: '#666', marginLeft: '4px'}}>cierres consecutivos fuera para confirmar entry</span>
            </div>

            {/* Botones */}
            <div style={{display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap'}}>
              <button
                style={{
                  ...styles.realtimeBtn,
                  backgroundColor: realtimeRunning ? '#C62828' : '#2E7D32',
                  opacity: realtimeLoading ? 0.6 : 1
                }}
                onClick={handleRealtimeToggle}
                disabled={realtimeLoading}
              >
                {realtimeLoading ? '...' : (realtimeRunning ? 'Detener' : 'Iniciar')}
              </button>

              <button
                style={{...styles.realtimeBtn, backgroundColor: '#1565C0'}}
                onClick={handleRealtimeConfigSave}
                disabled={realtimeLoading}
                title="Guarda parametros y reinicia si es necesario"
              >
                Aplicar Config
              </button>

              {realtimeRunning && (
                <>
                  <button
                    style={{...styles.realtimeBtn, backgroundColor: '#6A1B9A'}}
                    onClick={handleRealtimeReanalyze}
                    disabled={realtimeLoading}
                    title="Re-analizar historico con los parametros actuales"
                  >
                    Re-analizar
                  </button>
                  <button
                    style={{...styles.realtimeBtn, backgroundColor: '#455A64'}}
                    onClick={handleRealtimeClearCooldowns}
                    title="Limpiar cooldowns (para testing)"
                  >
                    Clear CD
                  </button>
                </>
              )}
            </div>

            {/* Boton pausar/reanudar deteccion - separado y prominente */}
            {realtimeRunning && (
              <button
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: detectionPaused ? '2px solid #FF9800' : '1px solid #555',
                  backgroundColor: detectionPaused ? '#E65100' : '#37474F',
                  color: detectionPaused ? '#FFF' : '#CFD8DC',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
                onClick={handleToggleDetectionPause}
                title={detectionPaused
                  ? "Reanudar re-deteccion de zonas en cada vela"
                  : "Pausar re-deteccion historica (solo tracking de trades y pending breakouts)"
                }
              >
                {detectionPaused
                  ? '>> DETECCION PAUSADA - Click para reanudar'
                  : 'Pausar re-deteccion historica'
                }
              </button>
            )}

            {/* Banner explicativo cuando pausado + boton Detectar ahora */}
            {detectionPaused && realtimeRunning && (
              <>
                <div style={{
                  marginTop: '4px',
                  padding: '5px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  backgroundColor: 'rgba(230, 81, 0, 0.1)',
                  color: '#FFB74D',
                  border: '1px solid #E6510030',
                  textAlign: 'center'
                }}>
                  Solo tracking SL/TP de trades abiertos + pending breakouts. No se re-detectan zonas.
                </div>
                <button
                  style={{
                    marginTop: '6px',
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #1E88E5',
                    backgroundColor: detectNowLoading ? '#1565C0' : '#0D47A1',
                    color: '#FFF',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: detectNowLoading ? 'wait' : 'pointer',
                    textAlign: 'center',
                    opacity: detectNowLoading ? 0.7 : 1
                  }}
                  onClick={handleDetectNow}
                  disabled={detectNowLoading}
                  title="Ejecutar deteccion UNA vez (no cambia el estado de pausa)"
                >
                  {detectNowLoading ? 'Detectando...' : 'Detectar ahora (1 vez)'}
                </button>
              </>
            )}

            {/* === OPTIMIZADOR V2 (Realtime Engine) === */}
            <div style={{marginTop: '12px', padding: '10px', backgroundColor: '#1A1A2E', borderRadius: '6px', border: '1px solid #2D1B69'}}>
              <div
                style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: showOptimizerV2 ? '8px' : 0}}
                onClick={() => setShowOptimizerV2(!showOptimizerV2)}
              >
                <h4 style={{margin: 0, fontSize: '13px', color: '#CE93D8'}}>
                  Optimizador V2 (Realtime)
                </h4>
                <span style={{fontSize: '12px', color: '#888'}}>{showOptimizerV2 ? '\u25B2' : '\u25BC'}</span>
              </div>

              {showOptimizerV2 && (
                <>
                  <div style={{fontSize: '11px', color: '#888', marginBottom: '10px'}}>
                    Grid search usando el motor incremental V2 (mismo que realtime). Usa {zoneDays} dias en {interval}m.
                  </div>

                  {/* Metrica objetivo */}
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px'}}>
                    <label style={{fontSize: '11px', color: '#B0B0B0', minWidth: '90px'}}>Optimizar para:</label>
                    <select
                      style={{padding: '3px 6px', borderRadius: '3px', border: '1px solid #444', backgroundColor: '#2A2A3A', color: '#E0E0E0', fontSize: '11px'}}
                      value={optV2Metric}
                      onChange={(e) => setOptV2Metric(e.target.value)}
                    >
                      <option value="expectancy">Expectancy (R)</option>
                      <option value="total_pnl_r">P&L Total (R)</option>
                      <option value="win_rate">Win Rate (%)</option>
                      <option value="profit_factor">Profit Factor</option>
                    </select>
                  </div>

                  {/* Tabla de parametros V2 */}
                  <div style={{marginBottom: '10px'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '24px 1fr 55px 55px 55px', gap: '4px', alignItems: 'center', marginBottom: '4px'}}>
                      <span style={{fontSize: '10px', color: '#666'}}></span>
                      <span style={{fontSize: '10px', color: '#666'}}>Parametro</span>
                      <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Min</span>
                      <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Max</span>
                      <span style={{fontSize: '10px', color: '#666', textAlign: 'center'}}>Step</span>
                    </div>

                    {Object.entries(optV2ParamRanges).map(([name, range]) => {
                      const labels = {
                        multiplier: 'ATR Multiplier',
                        ma_period: 'MA Period',
                        atr_period: 'ATR Period',
                        max_outside_bars: 'Max Outside',
                        min_bars: 'Min Bars',
                        max_range_pct: 'Max Range %',
                        body_ratio: 'Body Ratio',
                        breakout_confirm_bars: 'Confirm Bars',
                        tp_rr_ratio: 'TP R:R',
                        sl_poc_buffer_pct: 'POC Buffer %',
                        ttm_kc_multiplier: 'TTM KC Mult',
                        ttm_min_squeeze_bars: 'TTM Sq Bars',
                        grace_bars: 'Grace Bars',
                      };
                      const count = Math.min(Math.floor((range.max - range.min) / range.step) + 1, 20);
                      return (
                        <div key={name} style={{
                          display: 'grid',
                          gridTemplateColumns: '24px 1fr 55px 55px 55px',
                          gap: '4px',
                          alignItems: 'center',
                          marginBottom: '3px',
                          opacity: range.enabled ? 1 : 0.5
                        }}>
                          <input
                            type="checkbox"
                            checked={range.enabled}
                            onChange={(e) => handleOptV2RangeChange(name, 'enabled', e.target.checked)}
                            style={{margin: 0, cursor: 'pointer'}}
                          />
                          <span style={{fontSize: '11px', color: range.enabled ? '#B0B0B0' : '#666'}}>
                            {labels[name] || name}
                            {range.enabled && <span style={{color: '#555', marginLeft: '4px'}}>({count})</span>}
                          </span>
                          <input
                            type="number"
                            style={{width: '100%', padding: '3px 4px', borderRadius: '3px', border: '1px solid #444', backgroundColor: '#2A2A3A', color: '#E0E0E0', fontSize: '11px', textAlign: 'center'}}
                            value={range.min}
                            onChange={(e) => handleOptV2RangeChange(name, 'min', e.target.value)}
                            disabled={!range.enabled}
                          />
                          <input
                            type="number"
                            style={{width: '100%', padding: '3px 4px', borderRadius: '3px', border: '1px solid #444', backgroundColor: '#2A2A3A', color: '#E0E0E0', fontSize: '11px', textAlign: 'center'}}
                            value={range.max}
                            onChange={(e) => handleOptV2RangeChange(name, 'max', e.target.value)}
                            disabled={!range.enabled}
                          />
                          <input
                            type="number"
                            style={{width: '100%', padding: '3px 4px', borderRadius: '3px', border: '1px solid #444', backgroundColor: '#2A2A3A', color: '#E0E0E0', fontSize: '11px', textAlign: 'center'}}
                            value={range.step}
                            onChange={(e) => handleOptV2RangeChange(name, 'step', e.target.value)}
                            disabled={!range.enabled}
                            step="any"
                          />
                        </div>
                      );
                    })}

                    {/* Total combinaciones */}
                    {(() => {
                      let total = 1;
                      let enabledCount = 0;
                      for (const range of Object.values(optV2ParamRanges)) {
                        if (range.enabled) {
                          enabledCount++;
                          total *= Math.min(Math.floor((range.max - range.min) / range.step) + 1, 20);
                        }
                      }
                      return (
                        <div style={{fontSize: '11px', color: total > 5000 ? '#FF5722' : total > 500 ? '#FFC107' : '#4CAF50', marginTop: '6px'}}>
                          {enabledCount > 0
                            ? `${total.toLocaleString()} combinaciones (${enabledCount} parametros)`
                            : 'Selecciona al menos un parametro'
                          }
                          {total > 5000 && ' \u2014 Max: 5000'}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Boton estimar */}
                  {!optV2Estimate && !optV2Running && (
                    <button
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: optV2Estimating ? '#555' : '#6A1B9A',
                        color: '#FFF',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: optV2Estimating ? 'wait' : 'pointer',
                        marginBottom: '10px',
                        opacity: optV2Estimating ? 0.7 : 1,
                      }}
                      onClick={handleEstimateV2}
                      disabled={optV2Estimating || optV2Running || loading}
                    >
                      {optV2Estimating ? 'Estimando tiempo...' : 'Estimar y Ejecutar'}
                    </button>
                  )}

                  {/* Resultado de estimacion con confirmar/cancelar */}
                  {optV2Estimate && !optV2Running && (
                    <div style={{marginBottom: '10px', padding: '10px', backgroundColor: '#12122A', borderRadius: '6px', border: '1px solid #6A1B9A'}}>
                      <div style={{fontSize: '12px', color: '#CE93D8', fontWeight: 'bold', marginBottom: '8px'}}>
                        Estimacion de tiempo (V2)
                      </div>
                      <div style={{fontSize: '11px', color: '#E0E0E0', lineHeight: '1.6'}}>
                        <div>Combinaciones: <strong>{optV2Estimate.total_combos}</strong></div>
                        <div>Velas: <strong>{optV2Estimate.candles?.toLocaleString()}</strong></div>
                        <div>Tiempo por combo: <strong>{optV2Estimate.avg_per_combo}s</strong></div>
                        <div style={{marginTop: '4px', fontSize: '13px', color: optV2Estimate.estimated_seconds > 300 ? '#FF8A80' : optV2Estimate.estimated_seconds > 60 ? '#FFD54F' : '#A5D6A7'}}>
                          Tiempo estimado: <strong>
                            {optV2Estimate.estimated_seconds < 60
                              ? `${optV2Estimate.estimated_seconds.toFixed(0)} segundos`
                              : optV2Estimate.estimated_seconds < 3600
                                ? `${Math.floor(optV2Estimate.estimated_seconds / 60)} min ${Math.round(optV2Estimate.estimated_seconds % 60)}s`
                                : `${Math.floor(optV2Estimate.estimated_seconds / 3600)}h ${Math.round((optV2Estimate.estimated_seconds % 3600) / 60)} min`
                            }
                          </strong>
                        </div>
                      </div>
                      <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                        <button
                          style={{flex: 1, padding: '8px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#6A1B9A', color: '#FFF', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer'}}
                          onClick={handleOptimizeV2}
                        >
                          Confirmar y Ejecutar
                        </button>
                        <button
                          style={{flex: 0.6, padding: '8px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#444', color: '#CCC', fontSize: '12px', cursor: 'pointer'}}
                          onClick={handleCancelEstimateV2}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Indicador de progreso durante ejecucion */}
                  {optV2Running && (
                    <div style={{marginBottom: '10px', textAlign: 'center'}}>
                      <div style={{fontSize: '11px', color: '#CE93D8', marginBottom: '6px'}}>
                        Procesando combinaciones V2 en el backend...
                      </div>
                      <div style={{height: '4px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden', position: 'relative'}}>
                        <div
                          ref={el => {
                            if (el && !el.dataset.animated) {
                              el.dataset.animated = '1';
                              if (!document.getElementById('optV2BarAnim')) {
                                const style = document.createElement('style');
                                style.id = 'optV2BarAnim';
                                style.textContent = '@keyframes optV2BarSlide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}';
                                document.head.appendChild(style);
                              }
                            }
                          }}
                          style={{
                            height: '100%',
                            width: '40%',
                            backgroundColor: '#7B1FA2',
                            borderRadius: '2px',
                            position: 'absolute',
                            animation: 'optV2BarSlide 1.5s ease-in-out infinite'
                          }}
                        />
                      </div>
                      <div style={{fontSize: '10px', color: '#888', marginTop: '4px'}}>
                        Revisa los logs del backend para ver el progreso.
                      </div>
                    </div>
                  )}

                  {/* Resultados V2 */}
                  {optV2Results && optV2Results.results && optV2Results.results.length > 0 && (
                    <div style={{marginBottom: '10px'}}>
                      <div style={{fontSize: '11px', color: '#B0B0B0', marginBottom: '6px'}}>
                        Top {optV2Results.results.length} de {optV2Results.total_combos} combinaciones ({optV2Results.elapsed}s)
                        {' \u2014 Ordenado por '}<strong style={{color: '#CE93D8'}}>{optV2Results.metric}</strong>
                      </div>

                      <div style={{maxHeight: '250px', overflowY: 'auto', border: '1px solid #333', borderRadius: '4px'}}>
                        <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '10px'}}>
                          <thead>
                            <tr style={{backgroundColor: '#252536', position: 'sticky', top: 0}}>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>#</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>Params</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>WR%</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>W/L</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>PnL</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>Expect</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>PF</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}>DD</th>
                              <th style={{padding: '4px 6px', textAlign: 'center', color: '#888', fontWeight: 'normal', borderBottom: '1px solid #444', whiteSpace: 'nowrap'}}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {optV2Results.results.map((r, i) => (
                              <tr key={i} style={{
                                backgroundColor: i === 0 ? 'rgba(106, 27, 154, 0.15)' : (i % 2 === 0 ? '#1E1E2E' : '#252536'),
                                borderBottom: '1px solid #333'
                              }}>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: i === 0 ? '#CE93D8' : '#888', fontWeight: i === 0 ? 'bold' : 'normal', whiteSpace: 'nowrap'}}>
                                  {i + 1}
                                </td>
                                <td style={{padding: '4px 6px', textAlign: 'left', color: '#B0B0B0', maxWidth: '120px', whiteSpace: 'nowrap'}}>
                                  {Object.entries(r.params).map(([k, v]) => (
                                    <div key={k}>
                                      <span style={{color: '#888'}}>{k.replace(/_/g, ' ')}:</span>{' '}
                                      <span style={{color: '#E0E0E0'}}>{typeof v === 'number' ? (v % 1 ? v.toFixed(2) : v) : v}</span>
                                    </div>
                                  ))}
                                </td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: r.win_rate >= 50 ? '#4CAF50' : '#FF5722', whiteSpace: 'nowrap'}}>{r.win_rate}%</td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: '#B0B0B0', whiteSpace: 'nowrap'}}>{r.wins}/{r.losses}</td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: r.total_pnl_r >= 0 ? '#4CAF50' : '#FF5722', whiteSpace: 'nowrap'}}>
                                  {r.total_pnl_r > 0 ? '+' : ''}{r.total_pnl_r}R
                                </td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: r.expectancy >= 0 ? '#4CAF50' : '#FF5722', whiteSpace: 'nowrap'}}>
                                  {r.expectancy > 0 ? '+' : ''}{r.expectancy}
                                </td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: r.profit_factor >= 1.5 ? '#4CAF50' : r.profit_factor >= 1 ? '#FFC107' : '#FF5722', whiteSpace: 'nowrap'}}>
                                  {r.profit_factor}
                                </td>
                                <td style={{padding: '4px 6px', textAlign: 'center', color: '#FF5722', whiteSpace: 'nowrap'}}>-{r.max_drawdown_r}R</td>
                                <td style={{padding: '4px 6px', textAlign: 'center', whiteSpace: 'nowrap'}}>
                                  <button
                                    style={{padding: '2px 8px', borderRadius: '3px', border: '1px solid #7B1FA2', backgroundColor: 'transparent', color: '#CE93D8', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap'}}
                                    onClick={() => handleApplyOptV2Result(r.params)}
                                    title="Aplicar estos parametros al modal"
                                  >
                                    Aplicar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {optV2Results && optV2Results.results && optV2Results.results.length === 0 && (
                    <div style={{fontSize: '11px', color: '#FF5722', marginBottom: '10px'}}>
                      No se encontraron resultados validos. Intenta con rangos diferentes.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Mensaje de confirmacion de config */}
            {realtimeConfigMsg && (
              <div style={{
                marginTop: '6px',
                padding: '5px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                backgroundColor: realtimeConfigMsg.type === 'ok' ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 87, 34, 0.1)',
                color: realtimeConfigMsg.type === 'ok' ? '#81C784' : '#FF8A65',
                border: `1px solid ${realtimeConfigMsg.type === 'ok' ? '#4CAF5030' : '#FF572230'}`
              }}>
                {realtimeConfigMsg.type === 'ok' ? '>> ' : '!! '}{realtimeConfigMsg.text}
              </div>
            )}

            {/* Stats del servicio v2 */}
            {realtimeStatus && realtimeRunning && (
              <div style={{marginTop: '8px', fontSize: '11px', color: '#B0B0B0'}}>
                {/* Indicador de actividad: ultima vela procesada */}
                {(() => {
                  const candlesProcessed = realtimeStatus.stats?.candles_processed || 0;
                  const lastAgo = realtimeStatus.last_candle_ago_seconds;
                  const isReceiving = candlesProcessed > 0 && lastAgo != null && lastAgo < 600;
                  return (
                    <div style={{
                      padding: '6px 8px',
                      marginBottom: '6px',
                      borderRadius: '4px',
                      backgroundColor: isReceiving ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 152, 0, 0.1)',
                      border: `1px solid ${isReceiving ? '#4CAF5040' : '#FF980040'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: isReceiving ? '#4CAF50' : '#FF9800',
                      }} />
                      <span style={{color: isReceiving ? '#81C784' : '#FFB74D'}}>
                        {candlesProcessed === 0
                          ? 'Esperando primer cierre de vela...'
                          : `${candlesProcessed} velas procesadas`
                        }
                        {candlesProcessed > 0 && lastAgo != null && (
                          <span style={{color: '#999', marginLeft: '4px'}}>
                            (ultima hace {lastAgo < 60 ? `${lastAgo}s` : `${Math.round(lastAgo / 60)}m`})
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })()}

                <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
                  <span>Alertas: {realtimeStatus.stats?.alerts_sent || 0}</span>
                  <span>Bloq. cooldown: {realtimeStatus.stats?.alerts_blocked_cooldown || 0}</span>
                </div>
                <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px'}}>
                  <span>Uptime: {Math.round((realtimeStatus.uptime_seconds || 0) / 60)}m</span>
                </div>

                {/* Stats por detector (por simbolo) */}
                {realtimeStatus.detectors && Object.entries(realtimeStatus.detectors).map(([sym, det]) => (
                  <div key={sym} style={{marginTop: '4px', padding: '4px 6px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '3px'}}>
                    <span style={{fontWeight: 'bold', color: '#90CAF9'}}>{sym}</span>
                    {': '}
                    <span>{det.candles_in_buffer || 0} velas</span>
                    {' | '}
                    <span style={{color: det.building_zone ? '#4FC3F7' : '#666'}}>
                      {det.building_zone ? 'BUILDING' : 'idle'}
                    </span>
                    {det.complete_zones > 0 && <span>{' | '}{det.complete_zones} pending</span>}
                    {det.open_trades > 0 && <span style={{color: '#FFB300'}}>{' | '}{det.open_trades} open</span>}
                    {det.resolved_total > 0 && (
                      <span>
                        {' | '}W:{det.wins} L:{det.losses}
                        {' '}({det.win_rate}%)
                        {' '}PnL: <span style={{color: det.total_pnl_r >= 0 ? '#81C784' : '#EF5350'}}>
                          {det.total_pnl_r > 0 ? '+' : ''}{det.total_pnl_r}R
                        </span>
                      </span>
                    )}
                    {det.consecutive_pass > 0 && (
                      <span style={{color: '#4FC3F7'}}>{' | '}{det.consecutive_pass} bars OK</span>
                    )}
                  </div>
                ))}

                {realtimeStatus.cooldowns && Object.keys(realtimeStatus.cooldowns).length > 0 && (
                  <div style={{marginTop: '4px'}}>
                    Cooldowns activos: {Object.entries(realtimeStatus.cooldowns).map(([key, secs]) => (
                      <span key={key} style={{marginRight: '8px', color: '#FFA726'}}>{key}: {Math.round(secs)}s</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* === ALERTAS AL TRADING BOT (MANUALES) === */}
          <div style={styles.alertSection}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
              <h4 style={{...styles.sectionTitle, marginBottom: 0}}>Alertas Manuales</h4>
              <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={alertsEnabled}
                  onChange={(e) => handleToggleAlerts(e.target.checked)}
                  style={{cursor: 'pointer'}}
                />
                <span style={{fontSize: '12px', color: alertsEnabled ? '#4CAF50' : '#888'}}>
                  {alertsEnabled ? 'Activo' : 'Inactivo'}
                </span>
              </label>
            </div>

            {alertsEnabled && (
              <>
                <div style={{fontSize: '11px', color: '#888', marginBottom: '8px'}}>
                  Envia las zonas con breakout al TradingBot para ejecutar ordenes con SL/TP calculados.
                </div>

                <div style={styles.row}>
                  <label style={styles.label}>TradingBot URL:</label>
                  <input
                    type="text"
                    style={{...styles.input, width: '180px', textAlign: 'left', fontSize: '11px'}}
                    value={tradingBotUrl}
                    onChange={(e) => handleTradingBotUrlChange(e.target.value)}
                    placeholder="http://localhost:5000"
                  />
                </div>

                <div style={styles.row}>
                  <label style={styles.label}>Tipo de orden:</label>
                  <div style={{display: 'flex', gap: '4px'}}>
                    <button
                      style={{
                        ...styles.miniBtn,
                        backgroundColor: alertOrderType === 'market' ? '#1976D2' : '#333',
                        color: alertOrderType === 'market' ? '#fff' : '#aaa',
                        border: alertOrderType === 'market' ? '1px solid #42A5F5' : '1px solid #555'
                      }}
                      onClick={() => handleOrderTypeChange('market')}
                    >
                      Market
                    </button>
                    <button
                      style={{
                        ...styles.miniBtn,
                        backgroundColor: alertOrderType === 'limit' ? '#F57C00' : '#333',
                        color: alertOrderType === 'limit' ? '#fff' : '#aaa',
                        border: alertOrderType === 'limit' ? '1px solid #FFB74D' : '1px solid #555'
                      }}
                      onClick={() => handleOrderTypeChange('limit')}
                    >
                      Limit
                    </button>
                  </div>
                </div>
                <div style={{fontSize: '10px', color: '#777', marginTop: '-4px', marginBottom: '6px', paddingLeft: '2px'}}>
                  {alertOrderType === 'market'
                    ? 'Market: Compra al precio actual. TP/SL se calculan con los defaults del TradingBot.'
                    : 'Limit: Compra al entry_price de la zona. TP/SL exactos de la simulacion.'
                  }
                </div>

                {/* Boton enviar alertas (solo si hay zonas detectadas) */}
                {stats && detectedZones.length > 0 && (
                  <div style={{marginTop: '8px'}}>
                    <button
                      style={styles.alertBtn}
                      onClick={handleSendAlerts}
                      disabled={alertSending}
                    >
                      {alertSending ? 'Enviando...' : `Enviar ${alertOrderType === 'limit' ? 'Limit' : 'Market'} (${detectedZones.filter(z => {
                        if (!z.trade_result || z.trade_result === 'SKIPPED' || z.trade_result === 'NO_ENTRY' || !z.entry_price) return false;
                        if (alertOrderType === 'limit' && (!z.sl_price || !z.tp_price)) return false;
                        return true;
                      }).length} zonas)`}
                    </button>

                    {/* Resultado del envio */}
                    {alertResult && (
                      <div style={{
                        marginTop: '6px',
                        padding: '8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: alertResult.success ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 87, 34, 0.1)',
                        border: `1px solid ${alertResult.success ? '#4CAF50' : '#FF5722'}`,
                        color: alertResult.success ? '#4CAF50' : '#FF5722'
                      }}>
                        {alertResult.error
                          ? `Error: ${alertResult.error}`
                          : `Enviadas: ${alertResult.sent} | Fallidas: ${alertResult.failed} | Total validas: ${alertResult.total_valid}`
                        }
                        {alertResult.results && alertResult.results.length > 0 && (
                          <div style={{marginTop: '4px', fontSize: '11px', color: '#B0B0B0', maxHeight: '80px', overflowY: 'auto'}}>
                            {alertResult.results.map((r, i) => (
                              <div key={i} style={{color: r.success ? '#4CAF50' : '#FF5722'}}>
                                {r.direction} @ {r.entry_price} - {r.success ? 'OK' : r.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: '#1E1E2E',
    borderRadius: '8px',
    width: '400px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    backgroundColor: '#252536'
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: '#E0E0E0'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#888',
    cursor: 'pointer',
    padding: '0 4px'
  },
  content: {
    padding: '16px'
  },
  section: {
    marginBottom: '16px'
  },
  sectionTitle: {
    fontSize: '14px',
    color: '#B0B0B0',
    marginBottom: '8px',
    marginTop: 0
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  label: {
    fontSize: '13px',
    color: '#A0A0A0'
  },
  input: {
    width: '80px',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #444',
    backgroundColor: '#2A2A3A',
    color: '#E0E0E0',
    fontSize: '13px',
    textAlign: 'right'
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px'
  },
  detectBtn: {
    flex: 1,
    padding: '10px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#4A6FA5',
    color: 'white',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  clearBtn: {
    padding: '10px 16px',
    borderRadius: '4px',
    border: '1px solid #555',
    backgroundColor: 'transparent',
    color: '#A0A0A0',
    fontSize: '14px',
    cursor: 'pointer'
  },
  progressBar: {
    marginBottom: '12px',
    padding: '8px 0'
  },
  error: {
    backgroundColor: 'rgba(255, 87, 34, 0.1)',
    border: '1px solid #FF5722',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#FF5722',
    fontSize: '13px',
    marginBottom: '12px'
  },
  stats: {
    backgroundColor: '#252536',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '12px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px'
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px'
  },
  statLabel: {
    color: '#888'
  },
  statValue: {
    color: '#E0E0E0',
    fontWeight: 'bold'
  },
  csvInfo: {
    backgroundColor: '#252536',
    borderRadius: '4px',
    padding: '8px 12px',
    fontSize: '12px',
    color: '#A0A0A0',
    marginTop: '6px'
  },
  code: {
    backgroundColor: '#1A1A2A',
    padding: '2px 6px',
    borderRadius: '2px',
    fontSize: '11px',
    color: '#4FC3F7'
  },
  csvBtn: {
    width: '100%',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #4A6FA5',
    backgroundColor: 'transparent',
    color: '#4A6FA5',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  vpSection: {
    marginBottom: '12px',
    padding: '10px',
    backgroundColor: '#252536',
    borderRadius: '6px',
    border: '1px solid #333'
  },
  vpBtn: {
    padding: '6px 12px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#1565C0',
    color: '#fff',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  vpClearBtn: {
    padding: '6px 12px',
    borderRadius: '4px',
    border: '1px solid #666',
    backgroundColor: 'transparent',
    color: '#999',
    fontSize: '12px',
    cursor: 'pointer'
  },
  layerBlock: {
    marginBottom: '8px',
    borderRadius: '4px',
    border: '1px solid #333',
    overflow: 'hidden'
  },
  layerHeader: {
    padding: '6px 10px',
    backgroundColor: '#252536'
  },
  layerContent: {
    padding: '8px 10px',
    backgroundColor: '#1E1E2E',
    borderTop: '1px solid #333'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer'
  },
  layerName: {
    fontSize: '13px',
    color: '#C0C0C0'
  },
  // === PRESETS STYLES ===
  presetsSection: {
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #333'
  },
  presetsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  presetSelect: {
    flex: 1,
    minWidth: '120px',
    padding: '6px 8px',
    borderRadius: '4px',
    border: '1px solid #444',
    backgroundColor: '#2A2A3A',
    color: '#E0E0E0',
    fontSize: '12px',
    cursor: 'pointer'
  },
  presetDeleteBtn: {
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #FF5722',
    backgroundColor: 'transparent',
    color: '#FF5722',
    fontSize: '12px',
    cursor: 'pointer'
  },
  presetResetBtn: {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid #666',
    backgroundColor: 'transparent',
    color: '#888',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  presetSaveBtn: {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid #4A6FA5',
    backgroundColor: 'transparent',
    color: '#4A6FA5',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  presetInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  presetNameInput: {
    width: '120px',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #4A6FA5',
    backgroundColor: '#2A2A3A',
    color: '#E0E0E0',
    fontSize: '12px'
  },
  presetConfirmBtn: {
    padding: '4px 8px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#4CAF50',
    color: 'white',
    fontSize: '12px',
    cursor: 'pointer'
  },
  presetCancelBtn: {
    padding: '4px 8px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#666',
    color: 'white',
    fontSize: '12px',
    cursor: 'pointer'
  },
  presetCount: {
    fontSize: '10px',
    color: '#666',
    marginTop: '4px'
  },
  // === REALTIME STYLES ===
  realtimeSection: {
    marginBottom: '12px',
    padding: '10px',
    backgroundColor: '#1A2332',
    borderRadius: '6px',
    border: '1px solid #1565C0'
  },
  realtimeBtn: {
    padding: '5px 10px',
    borderRadius: '4px',
    border: 'none',
    color: 'white',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '500'
  },
  // === ALERTAS STYLES ===
  alertSection: {
    marginBottom: '12px',
    padding: '10px',
    backgroundColor: '#252536',
    borderRadius: '6px',
    border: '1px solid #333'
  },
  alertBtn: {
    width: '100%',
    padding: '8px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#E65100',
    color: 'white',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  miniBtn: {
    padding: '4px 10px',
    borderRadius: '3px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  // Optimizer styles
  optimizerSection: {
    marginBottom: '12px',
    padding: '10px',
    backgroundColor: '#1A1A2E',
    borderRadius: '6px',
    border: '1px solid #2D1B69'
  },
  optInput: {
    width: '100%',
    padding: '3px 4px',
    borderRadius: '3px',
    border: '1px solid #444',
    backgroundColor: '#2A2A3A',
    color: '#E0E0E0',
    fontSize: '11px',
    textAlign: 'center'
  },
  th: {
    padding: '4px 6px',
    textAlign: 'center',
    color: '#888',
    fontWeight: 'normal',
    borderBottom: '1px solid #444',
    whiteSpace: 'nowrap'
  },
  td: {
    padding: '4px 6px',
    textAlign: 'center',
    color: '#B0B0B0',
    whiteSpace: 'nowrap'
  },
  applyBtn: {
    padding: '2px 8px',
    borderRadius: '3px',
    border: '1px solid #7B1FA2',
    backgroundColor: 'transparent',
    color: '#CE93D8',
    fontSize: '10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
};

export default ZoneDetectorSettings;
