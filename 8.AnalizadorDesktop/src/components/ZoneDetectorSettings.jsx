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
  consol_body_ratio: 0.5,
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
  // Filtro de calidad
  min_score_filter: 0,  // 0 = sin filtro, >0 = score minimo para incluir zona
  use_continuation_score: false,  // Solo usar con swing_confirmation (ya pasaron velas)
  // Volume Profile por zona (para va_breakout)
  sl_poc_buffer_pct: 50.0,  // % buffer sobre distancia entry->POC para SL
  vp_bins_per_zone: 30      // Bins de precio para VP de cada zona
};

// Limites maximos de dias por timeframe (debe coincidir con backend)
// 5min: 400 dias = 115,200 velas (para backtesting extenso)
const MAX_DAYS_BY_INTERVAL = {
  "1": 7, "3": 21, "5": 400, "15": 180, "30": 360,
  "60": 730, "120": 730, "240": 1095, "D": 2000, "W": 1000
};

// Dias por defecto para deteccion de zonas
const DEFAULT_ZONE_DAYS_BY_INTERVAL = {
  "1": 3, "3": 7, "5": 60, "15": 90, "30": 120,
  "60": 180, "120": 180, "240": 365, "D": 730, "W": 730
};

// Campos que son strings (no numericos) - fuera del componente para estabilidad
const STRING_PARAMS = ['entry_mode', 'position_mode', 'sl_mode', 'detection_method'];
// Campos booleanos (toggles de capas)
const BOOL_PARAMS = ['use_atr_band', 'use_reentry', 'use_ttm_prefilter', 'use_bbwp_scoring', 'use_inside_pct_filter', 'atr_dyn_merge_overlap', 'use_continuation_score'];

function ZoneDetectorSettings({ isOpen, onClose, indicatorManager, onZonesLoaded, symbol, interval }) {
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
  const [realtimeStatus, setRealtimeStatus] = useState(null);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [realtimeWindowCandles, setRealtimeWindowCandles] = useState(500);
  const [realtimeCooldown, setRealtimeCooldown] = useState(30);
  const [realtimeMinScore, setRealtimeMinScore] = useState(0);
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
  });

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
      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/status`);
      const data = await res.json();
      if (data.success) {
        setRealtimeEnabled(data.enabled || false);
        setRealtimeRunning(data.running || false);
        setRealtimeStatus(data);
        // Solo actualizar inputs de config cuando se indica explicitamente
        // (al abrir el modal o despues de guardar). El polling NO sobrescribe
        // los valores que el usuario pueda estar editando.
        if (syncConfig && data.config) {
          setRealtimeWindowCandles(data.config.window_candles || 500);
          setRealtimeCooldown(data.config.cooldownMinutes || 30);
          setRealtimeMinScore(data.config.min_score_filter || 0);
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

  const handleDetect = useCallback(async () => {
    const manager = getManager();
    console.log(`[ZoneDetector] handleDetect: manager=${!!manager}, symbol=${symbol}, interval=${interval}, days=${zoneDays}`);
    if (!manager) {
      setError('IndicatorManager no disponible. Espera a que el grafico cargue.');
      return;
    }

    setLoading(true);
    setError(null);
    setCsvPath(null);
    setCandlesCount(null);
    setProgress({ phase: 'starting', message: 'Iniciando deteccion...' });

    const intervalMinutes = {1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60;
    const expectedCandles = Math.ceil((zoneDays * 24 * 60) / intervalMinutes);
    console.log(`[ZoneDetector] Esperando ~${expectedCandles} velas (${zoneDays} dias en ${interval}m)`);
    console.log(`[ZoneDetector] PARAMS enviados:`, JSON.stringify({entry_mode: params.entry_mode, position_mode: params.position_mode, swing_bars: params.swing_bars}));

    try {
      const startTime = Date.now();

      // Timer para mostrar tiempo transcurrido
      const timer = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        setProgress(prev => prev ? {
          ...prev,
          message: `${prev.phase === 'fetching' ? 'Descargando' : 'Procesando'} ~${expectedCandles} velas (${elapsed}s)...`
        } : null);
      }, 1000);

      const result = await manager.loadTradingZones({
        ...params,
        days: zoneDays,
        _onProgress: (p) => setProgress(p)
      });

      clearInterval(timer);

      if (result.success) {
        setStats(result.stats);
        setDetectedZones(result.zones || []);
        setCandlesCount(result.candles_count || null);
        setCsvPath(null);  // Reset csv path (se genera con boton aparte)
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        setProgress({ phase: 'done', message: `Completado en ${elapsed}s` });
        if (onZonesLoaded) {
          onZonesLoaded(result);
        }
      } else {
        setError(result.error || 'Error detectando zonas');
        setProgress(null);
      }
    } catch (err) {
      console.error(`[ZoneDetector] ERROR:`, err.name, err.message, err);
      setError(err.message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [getManager, params, zoneDays, onZonesLoaded, interval, symbol]);

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

  const handleClear = useCallback(() => {
    const manager = getManager();
    if (manager) {
      manager.clearTradingZones();
      manager.clearZoneDetectorFixedRanges();
      setStats(null);
      setDetectedZones([]);
      setVpCount(0);
      setCsvPath(null);
    }
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
  }, [getManager, symbol, interval, zoneDays, params]);

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
        ? `${API_BASE_URL}/api/zones/realtime/stop`
        : `${API_BASE_URL}/api/zones/realtime/start`;
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
        console.error('[ZoneDetector] Error toggling realtime:', data.error);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error toggling realtime:', e);
    } finally {
      setRealtimeLoading(false);
    }
  }, [realtimeRunning, fetchRealtimeStatus, getManager]);

  const handleRealtimeConfigSave = useCallback(async () => {
    setRealtimeLoading(true);
    setRealtimeConfigMsg(null);
    try {
      // Enviar config actual de parametros del detector + realtime settings
      const configPayload = {
        symbols: [symbol],
        interval: interval,
        window_candles: realtimeWindowCandles,
        cooldownMinutes: realtimeCooldown,
        min_score_filter: realtimeMinScore,
        alertsEnabled: alertsEnabled,
        alertTargetUrl: `${tradingBotUrl}/api/watchlist-alert`,
        // Pasar parametros de deteccion actuales
        consol_min_bars: params.consol_min_bars,
        consol_max_bars: params.consol_max_bars,
        consol_max_range_pct: params.consol_max_range_pct,
        consol_atr_ratio: params.consol_atr_ratio,
        consol_body_ratio: params.consol_body_ratio,
        consol_max_outside_bars: params.consol_max_outside_bars,
        breakout_search_bars: typeof params.breakout_search_bars === 'number' ? params.breakout_search_bars : 20,
        entry_mode: params.entry_mode || 'breakout_close',
        sl_mode: params.sl_mode || 'zone_opposite',
        sl_poc_buffer_pct: params.sl_poc_buffer_pct || 50.0,
        swing_bars: params.swing_bars || 5,
        max_price_range_pct: params.max_price_range_pct || 5.0,
        vp_bins_per_zone: params.vp_bins_per_zone || 30,
        // Capas v3.0
        use_atr_band: !!params.use_atr_band,
        use_reentry: !!params.use_reentry,
        use_ttm_prefilter: !!params.use_ttm_prefilter,
        use_bbwp_scoring: !!params.use_bbwp_scoring,
        use_inside_pct_filter: !!params.use_inside_pct_filter,
      };

      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/config`, {
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
      alertsEnabled, tradingBotUrl, params, fetchRealtimeStatus]);

  const handleRealtimeClearCooldowns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/clear-cooldowns`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log('[ZoneDetector] Cooldowns limpiados');
        // Solo actualizar stats, no sobrescribir inputs
        await fetchRealtimeStatus(false);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error limpiando cooldowns:', e);
    }
  }, [fetchRealtimeStatus]);

  const handleRealtimeReanalyze = useCallback(async () => {
    setRealtimeLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/realtime/reanalyze`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log('[ZoneDetector] Re-analisis realtime completado');
        // Solo actualizar stats (zonas detectadas), no sobrescribir inputs
        await fetchRealtimeStatus(false);
      }
    } catch (e) {
      console.error('[ZoneDetector] Error re-analizando:', e);
    } finally {
      setRealtimeLoading(false);
    }
  }, [fetchRealtimeStatus]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>🎯 Detector de Zonas</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
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

          {/* Botones de acción */}
          <div style={styles.actions}>
            <button
              style={styles.detectBtn}
              onClick={handleDetect}
              disabled={loading}
            >
              {loading ? 'Detectando...' : 'Detectar Zonas'}
            </button>
            <button
              style={styles.clearBtn}
              onClick={handleClear}
            >
              🗑️ Limpiar
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
              <h4 style={styles.sectionTitle}>Resultados</h4>
              {candlesCount && (
                <div style={{fontSize: '11px', color: '#888', marginBottom: '4px'}}>
                  {candlesCount.toLocaleString()} velas analizadas ({zoneDays} dias, {interval}m)
                </div>
              )}
              {stats.entry_mode && (
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
              </div>
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

          {/* Exportar CSV (solo visible despues de detectar) */}
          {stats && (
            <div style={{marginBottom: '12px'}}>
              <button
                style={styles.csvBtn}
                onClick={handleExportCsv}
                disabled={exportingCsv}
              >
                {exportingCsv ? 'Exportando...' : 'Exportar CSV'}
              </button>
              {csvPath && (
                <div style={styles.csvInfo}>
                  CSV guardado: <code style={styles.code}>{csvPath}</code>
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

            {/* Stats del servicio */}
            {realtimeStatus && realtimeRunning && (
              <div style={{marginTop: '8px', fontSize: '11px', color: '#B0B0B0'}}>
                {/* Indicador de actividad: ultima vela procesada */}
                {(() => {
                  const candlesProcessed = realtimeStatus.stats?.candles_processed || 0;
                  const lastAgo = realtimeStatus.last_candle_ago_seconds;
                  const detectionsRun = realtimeStatus.stats?.detections_run || 0;
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
                        animation: isReceiving ? 'none' : undefined
                      }} />
                      <span style={{color: isReceiving ? '#81C784' : '#FFB74D'}}>
                        {candlesProcessed === 0
                          ? 'Esperando primer cierre de vela...'
                          : `${candlesProcessed} velas procesadas, ${detectionsRun} detecciones`
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
                  <span>Zonas nuevas: {realtimeStatus.stats?.zones_detected || 0}</span>
                  <span>Alertas: {realtimeStatus.stats?.alerts_sent || 0}</span>
                  <span>Bloq. cooldown: {realtimeStatus.stats?.alerts_blocked_cooldown || 0}</span>
                  <span>Bloq. score: {realtimeStatus.stats?.alerts_blocked_score || 0}</span>
                </div>
                <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px'}}>
                  <span>Uptime: {Math.round((realtimeStatus.uptime_seconds || 0) / 60)}m</span>
                  {realtimeStatus.stats?.last_detection_zones != null && realtimeStatus.stats?.detections_run > 0 && (
                    <span>Ult. deteccion: {realtimeStatus.stats.last_detection_zones} zonas en buffer</span>
                  )}
                </div>
                {realtimeStatus.buffers && (
                  <div style={{marginTop: '4px'}}>
                    Buffers: {Object.entries(realtimeStatus.buffers).map(([sym, count]) => (
                      <span key={sym} style={{marginRight: '8px'}}>{sym}: {count} velas</span>
                    ))}
                  </div>
                )}
                {realtimeStatus.known_zones && Object.values(realtimeStatus.known_zones).some(v => v > 0) && (
                  <div style={{marginTop: '4px'}}>
                    Zonas conocidas: {Object.entries(realtimeStatus.known_zones).map(([sym, count]) => (
                      <span key={sym} style={{marginRight: '8px'}}>{sym}: {count}</span>
                    ))}
                  </div>
                )}
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
