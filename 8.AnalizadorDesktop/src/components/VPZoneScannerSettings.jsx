// VPZoneScannerSettings.jsx
// Panel para configurar y ejecutar el VP Zone Scanner (Volume Profile)

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';
import { API_BASE_URL } from '../config';

const defaultParams = {
  window_size: 30,
  window_step: 5,
  bins: 50,
  va_percent: 0.70,
  min_d_score: 40,
  include_pb_shapes: true,
  min_zone_candles: 10,
  merge_gap: 3,
  max_range_pct: 2.0,
  lookforward_bars: 100,
  tp_rr_ratio: 2.0,
  sl_buffer_pct: 0.1,
  sl_mode: "below_va",
  entry_mode: "va",
  breakout_confirm_bars: 0,
  position_mode: "sequential",
  warmup_candles: 50,
  // Deteccion progresiva
  detection_mode: "fixed_window",
  prog_min_candles: 30,
  prog_range_pct: 1.5,
  prog_stop_mode: "breakout",
  prog_degrade_bars: 5,
  prog_close_outside_bars: 3,
  prog_close_reference: "va",
  prog_thickness_metric: "kurtosis",
  // Estrategia de trading
  entry_strategy: "breakout",
  // Mean Reversion
  mr_target: "poc",
  mr_entry_zone: "va",
  mr_confirm: "rejection",
  mr_swing_bars: 3,
  mr_sl_mode: "beyond_zone",
  mr_sl_buffer_pct: 0.15,
  mr_min_zone_candles: 15,
  mr_max_trades_per_zone: 3,
  // Retest
  rt_max_bars: 30,
  rt_level: "va",
  rt_confirm: "rejection",
  rt_swing_bars: 3,
  rt_sl_mode: "below_retest",
  rt_must_reenter: true,
  // Breakout refinado
  bo_volume_filter: false,
  bo_volume_zscore: 1.0,
  bo_momentum_bars: 0,
};

const MAX_DAYS_BY_INTERVAL = {
  "1": 400, "3": 400, "5": 400, "15": 730, "30": 730,
  "60": 1095, "120": 1095, "240": 1095, "D": 2000, "W": 1000
};

const DEFAULT_ZONE_DAYS = {
  "1": 3, "3": 7, "5": 60, "15": 90, "30": 120,
  "60": 180, "120": 180, "240": 365, "D": 730, "W": 730
};

const STRING_PARAMS = ['sl_mode', 'entry_mode', 'position_mode', 'detection_mode', 'prog_stop_mode', 'prog_thickness_metric',
  'prog_close_reference', 'entry_strategy', 'mr_target', 'mr_entry_zone', 'mr_confirm', 'mr_sl_mode', 'rt_level', 'rt_confirm', 'rt_sl_mode'];
const BOOL_PARAMS = ['include_pb_shapes', 'rt_must_reenter', 'bo_volume_filter'];

// Parametros que afectan la DETECCION de zonas (cambiarlos requiere re-deteccion completa)
const DETECTION_PARAMS = [
  'window_size', 'window_step', 'bins', 'va_percent', 'min_d_score',
  'include_pb_shapes', 'min_zone_candles', 'merge_gap', 'max_range_pct',
  'warmup_candles',
  'detection_mode', 'prog_min_candles', 'prog_range_pct', 'prog_stop_mode',
  'prog_degrade_bars', 'prog_close_outside_bars', 'prog_close_reference',
  'prog_thickness_metric',
];

// Estilos inline reutilizables
const sectionStyle = {
  padding: '12px',
  backgroundColor: 'rgba(255,255,255,0.03)',
  borderRadius: '8px',
  marginBottom: '12px',
  border: '1px solid rgba(255,255,255,0.08)',
};

const labelStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: '12px', color: '#aaa', marginBottom: '4px'
};

const sliderStyle = {
  width: '100%', accentColor: '#0056D2'
};

const btnPrimary = {
  padding: '10px 20px', backgroundColor: '#0056D2', color: 'white',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600
};

const btnDanger = {
  padding: '10px 20px', backgroundColor: '#dc3545', color: 'white',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600
};

const btnSecondary = {
  padding: '8px 16px', backgroundColor: '#4A6FA5', color: 'white',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px'
};


function VPZoneScannerSettings({ isOpen, onClose, onOpen, indicatorManager, symbol, interval, onRealtimeChange }) {
  const maxDays = useMemo(() => MAX_DAYS_BY_INTERVAL[String(interval)] || 400, [interval]);
  const defaultDays = useMemo(() => DEFAULT_ZONE_DAYS[String(interval)] || 60, [interval]);

  const [params, setParams] = useState(defaultParams);
  const [zoneDays, setZoneDays] = useState(defaultDays);
  const [activeTab, setActiveTab] = useState('backtest'); // 'backtest' | 'realtime' | 'optimizer' | 'strat_optimizer'
  const [loading, setLoading] = useState(false);
  const [btProgress, setBtProgress] = useState(null); // { phase, current, total, elapsed, estimated_remaining, zones_found }
  const btProgressRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [zones, setZones] = useState(null);
  const [showTrades, setShowTrades] = useState(false);
  const [error, setError] = useState(null);

  // Realtime
  const [rtRunning, setRtRunning] = useState(false);
  const [rtLoading, setRtLoading] = useState(false);
  const [rtStatus, setRtStatus] = useState(null);
  const [rtMsg, setRtMsg] = useState(null);
  const rtPollingRef = useRef(null);

  // Optimizer
  const [optParamRanges, setOptParamRanges] = useState({});
  const [optMetric, setOptMetric] = useState('expectancy');
  const [optEstimate, setOptEstimate] = useState(null);
  const [optResults, setOptResults] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optPhase, setOptPhase] = useState(null); // 'estimating' | 'running' | null
  const [optProgress, setOptProgress] = useState(null); // { current, total, elapsed, estimated_remaining, ... }
  const optProgressRef = useRef(null);

  // Strategy Optimizer (zonas fijas)
  const [soParamRanges, setSoParamRanges] = useState({});
  const [soMetric, setSoMetric] = useState('expectancy');
  const [soEstimate, setSoEstimate] = useState(null);
  const [soResults, setSoResults] = useState(null);
  const [soLoading, setSoLoading] = useState(false);
  const [soPhase, setSoPhase] = useState(null); // 'estimating' | 'running' | null
  const [soProgress, setSoProgress] = useState(null);
  const soProgressRef = useRef(null);
  const [soStrategies, setSoStrategies] = useState(['breakout']); // estrategias a probar

  // Zone cache tracking: guarda params de deteccion del ultimo backtest exitoso
  const [lastDetectionParams, setLastDetectionParams] = useState(null);
  const [lastBacktestMeta, setLastBacktestMeta] = useState(null); // { symbol, interval, days }

  // Incremental detection
  const [incRunning, setIncRunning] = useState(false);
  const [incPaused, setIncPaused] = useState(false);
  const [incPhase, setIncPhase] = useState(''); // fetching|detecting|paused|stopped|done
  const [incStatus, setIncStatus] = useState(null); // { current_chunk, total_chunks, zones_count, elapsed, estimated_remaining }
  const [incZones, setIncZones] = useState([]); // zonas parciales acumuladas
  const [incMinimized, setIncMinimized] = useState(false);
  const incPollingRef = useRef(null);
  const incZoneCountRef = useRef(0); // para polling incremental de zonas
  const [incSavedState, setIncSavedState] = useState(null); // estado guardado en disco detectado
  const [incLoadingState, setIncLoadingState] = useState(false); // cargando estado guardado

  // Presets
  const [presets, setPresets] = useState({}); // { "nombre": { params, zoneDays, savedAt } }
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetMsg, setPresetMsg] = useState(null);

  const getManager = useCallback(() => {
    return indicatorManager || IndicatorManagerRegistry.get(symbol);
  }, [indicatorManager, symbol]);

  // Detecta si solo cambiaron params de estrategia respecto al ultimo backtest
  const isStrategyOnlyChange = useMemo(() => {
    if (!lastDetectionParams || !lastBacktestMeta) return false;
    // Verificar que symbol, interval y days coincidan
    if (lastBacktestMeta.symbol !== symbol ||
        lastBacktestMeta.interval !== interval ||
        lastBacktestMeta.days !== zoneDays) return false;
    // Comparar cada param de deteccion
    for (const p of DETECTION_PARAMS) {
      const current = params[p];
      const cached = lastDetectionParams[p];
      if (current !== cached && String(current) !== String(cached)) return false;
    }
    return true;
  }, [params, lastDetectionParams, lastBacktestMeta, symbol, interval, zoneDays]);

  // ---- Param change handler ----
  const handleParamChange = useCallback((key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: BOOL_PARAMS.includes(key)
        ? Boolean(value)
        : STRING_PARAMS.includes(key) ? value : Number(value)
    }));
  }, []);

  // ---- Lista expandida de trades (incluye sub-trades MR) ----
  const expandedTrades = useMemo(() => {
    if (!zones || zones.length === 0) return [];
    const trades = [];
    zones.forEach((z, zIdx) => {
      if (z.mr_trades && z.mr_trades.length > 0) {
        z.mr_trades.forEach((t, tIdx) => {
          trades.push({
            zoneIndex: zIdx + 1,
            subIndex: tIdx + 1,
            label: `#${zIdx + 1}.${tIdx + 1}`,
            direction: t.direction,
            entry_price: t.entry_price,
            sl_price: t.sl_price,
            tp_price: t.tp_price,
            entry_timestamp: t.entry_timestamp,
            trade_close_timestamp: t.trade_close_timestamp,
            trade_result: t.trade_result,
            trade_pnl_r: t.trade_pnl_r,
            strategy: 'mean_reversion',
          });
        });
      } else if (z.trade_result && z.trade_result !== 'SKIPPED' && z.trade_result !== 'NO_ENTRY' && z.trade_result !== 'NO_BREAKOUT') {
        trades.push({
          zoneIndex: zIdx + 1,
          subIndex: 0,
          label: `#${zIdx + 1}`,
          direction: z.breakout_direction,
          entry_price: z.entry_price,
          sl_price: z.sl_price,
          tp_price: z.tp_price,
          entry_timestamp: z.entry_timestamp,
          trade_close_timestamp: z.trade_close_timestamp,
          trade_result: z.trade_result,
          trade_pnl_r: z.trade_pnl_r,
          strategy: z.entry_strategy || 'breakout',
        });
      }
    });
    return trades;
  }, [zones]);

  const handleNavigateToTrade = useCallback((timestamp) => {
    const manager = getManager();
    if (manager && manager.navigateToTimestamp) {
      manager.navigateToTimestamp(timestamp);
    }
  }, [getManager]);

  // Auto-limpiar mensajes de presets despues de 3 segundos
  useEffect(() => {
    if (!presetMsg) return;
    const t = setTimeout(() => setPresetMsg(null), 3000);
    return () => clearTimeout(t);
  }, [presetMsg]);

  // ---- Presets: fetch al abrir y al cambiar modo ----
  const fetchPresets = useCallback(async (mode) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/presets?mode=${mode}`);
      const data = await res.json();
      if (data.success) {
        setPresets(data.presets || {});
        setSelectedPreset('');
      }
    } catch (e) {
      console.debug('[VPScanner] Error cargando presets:', e.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPresets(params.detection_mode);
    }
  }, [isOpen, params.detection_mode, fetchPresets]);

  // ---- Verificar estado incremental guardado en disco al abrir modal ----
  useEffect(() => {
    if (!isOpen) return;
    // Solo verificar si no hay deteccion en curso ni zonas ya cargadas
    if (incRunning || incZones.length > 0) return;
    const checkSaved = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/zones/vp/incremental-saved?symbol=${symbol}&interval=${interval}&days=${zoneDays}`
        );
        const data = await res.json();
        if (data.found && data.zones_count > 0) {
          setIncSavedState(data);
        } else {
          setIncSavedState(null);
        }
      } catch (e) {
        setIncSavedState(null);
      }
    };
    checkSaved();
  }, [isOpen, symbol, interval, zoneDays, incRunning, incZones.length]);

  const handleLoadSavedState = useCallback(async () => {
    setIncLoadingState(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          days: zoneDays,
          config: params,
        }),
      });
      const data = await res.json();
      if (data.success && data.zones) {
        const loadedZones = data.zones;
        // Alimentar estado incremental
        setIncZones(loadedZones);
        incZoneCountRef.current = data.zones_count || loadedZones.length;
        setIncPhase(data.is_complete ? 'done' : 'stopped');
        setIncStatus({
          current_chunk: data.chunks_completed,
          total_chunks: data.total_chunks,
          zones_count: data.zones_count,
          chunks_completed: data.chunks_completed,
          elapsed: 0,
          estimated_remaining: 0,
        });
        setIncRunning(false);
        setIncSavedState(null);
        // Tambien alimentar estado de backtest normal para que la tabla funcione
        setZones(loadedZones);
        // Calcular stats basicas
        const allTrades = [];
        loadedZones.forEach(z => {
          if (z.mr_trades && z.mr_trades.length > 0) {
            z.mr_trades.forEach(t => allTrades.push(t));
          } else if (z.trade_result && z.trade_result !== 'SKIPPED' && z.trade_result !== 'NO_ENTRY' && z.trade_result !== 'NO_BREAKOUT') {
            allTrades.push(z);
          }
        });
        const resolved = allTrades.filter(t => t.trade_result === 'WIN' || t.trade_result === 'LOSS');
        const wins = resolved.filter(t => t.trade_result === 'WIN');
        const losses = resolved.filter(t => t.trade_result === 'LOSS');
        const totalClosed = wins.length + losses.length;
        const totalPnlR = resolved.reduce((s, t) => s + (t.trade_pnl_r || 0), 0);
        const winRate = totalClosed > 0 ? (wins.length / totalClosed * 100) : 0;
        const expectancy = totalClosed > 0 ? (totalPnlR / totalClosed) : 0;
        const grossProfit = wins.reduce((s, t) => s + (t.trade_pnl_r || 0), 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.trade_pnl_r || 0), 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.9 : 0);
        setStats({
          total_zones: loadedZones.length,
          total_trades: allTrades.length,
          wins: wins.length,
          losses: losses.length,
          open: allTrades.filter(t => t.trade_result === 'OPEN').length,
          total_closed: totalClosed,
          win_rate: Math.round(winRate * 10) / 10,
          total_pnl_r: Math.round(totalPnlR * 100) / 100,
          expectancy: Math.round(expectancy * 1000) / 1000,
          profit_factor: Math.round(profitFactor * 100) / 100,
          from_zone_cache: true,
        });
        // Enviar zonas al chart
        const manager = getManager();
        if (manager && manager.zoneVisualizerIndicator) {
          manager.zoneVisualizerIndicator.setVPZones(loadedZones);
          if (manager.requestRedraw) manager.requestRedraw();
        }
      } else {
        setError(data.error || 'Error cargando estado guardado');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIncLoadingState(false);
    }
  }, [symbol, interval, zoneDays, params, getManager]);

  const handleSavePreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) return;
    setPresetMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/presets/${params.detection_mode}/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: { ...params },
          zoneDays,
          savedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPresetMsg({ type: 'ok', text: `Preset "${name}" guardado` });
        setPresetName('');
        await fetchPresets(params.detection_mode);
        setSelectedPreset(name);
      } else {
        setPresetMsg({ type: 'error', text: data.error });
      }
    } catch (e) {
      setPresetMsg({ type: 'error', text: e.message });
    }
  }, [presetName, params, zoneDays, fetchPresets]);

  const handleLoadPreset = useCallback((name) => {
    if (!name || !presets[name]) return;
    const preset = presets[name];
    if (preset.params) {
      setParams(prev => ({ ...prev, ...preset.params }));
    }
    if (preset.zoneDays != null) {
      setZoneDays(preset.zoneDays);
    }
    setSelectedPreset(name);
    setPresetMsg({ type: 'ok', text: `Preset "${name}" cargado` });
  }, [presets]);

  const handleDeletePreset = useCallback(async (name) => {
    if (!name) return;
    setPresetMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/presets/${params.detection_mode}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setPresetMsg({ type: 'ok', text: `Preset "${name}" eliminado` });
        setSelectedPreset('');
        await fetchPresets(params.detection_mode);
      } else {
        setPresetMsg({ type: 'error', text: data.error });
      }
    } catch (e) {
      setPresetMsg({ type: 'error', text: e.message });
    }
  }, [params.detection_mode, fetchPresets]);

  // Polling de progreso de optimizacion (estimating + running)
  useEffect(() => {
    if (optPhase !== 'running' && optPhase !== 'estimating') {
      if (optProgressRef.current) {
        clearInterval(optProgressRef.current);
        optProgressRef.current = null;
      }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize-progress`);
        const data = await res.json();
        if (data.running || data.phase === 'estimating') {
          setOptProgress(data);
        } else if (data.current > 0 && data.current >= data.total) {
          setOptProgress(data); // Ultimo update
        }
      } catch (e) { /* silencio */ }
    };
    poll(); // Inmediato
    const intervalMs = optPhase === 'estimating' ? 2000 : 3000;
    optProgressRef.current = setInterval(poll, intervalMs);
    return () => {
      if (optProgressRef.current) {
        clearInterval(optProgressRef.current);
        optProgressRef.current = null;
      }
    };
  }, [optPhase]);

  // Polling de progreso del backtest VP
  useEffect(() => {
    if (!loading) {
      if (btProgressRef.current) {
        clearInterval(btProgressRef.current);
        btProgressRef.current = null;
      }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/zones/vp/backtest-progress`);
        const data = await res.json();
        if (data.running || data.phase === 'done') {
          setBtProgress(data);
        }
      } catch (e) { /* silencio */ }
    };
    // Poll inmediato + cada 1.5s para capturar progreso rapido
    poll();
    btProgressRef.current = setInterval(poll, 1500);
    return () => {
      if (btProgressRef.current) {
        clearInterval(btProgressRef.current);
        btProgressRef.current = null;
      }
    };
  }, [loading]);

  // ---- Polling de deteccion incremental ----
  useEffect(() => {
    if (!incRunning && incPhase !== 'stopped' && incPhase !== 'done') {
      if (incPollingRef.current) {
        clearInterval(incPollingRef.current);
        incPollingRef.current = null;
      }
      return;
    }
    // Solo hacer polling mientras esta corriendo o recien terminado
    if (!incRunning && incPhase !== 'done' && incPhase !== 'stopped') return;

    const poll = async () => {
      try {
        // 1. Status
        const statusRes = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-status`);
        const statusData = await statusRes.json();
        setIncStatus(statusData);
        setIncRunning(statusData.running);
        setIncPaused(statusData.paused);
        setIncPhase(statusData.phase);

        // 2. Zonas (solo las nuevas desde ultimo fetch)
        const zonesRes = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-zones?since=${incZoneCountRef.current}`);
        const zonesData = await zonesRes.json();
        if (zonesData.zones && zonesData.zones.length > 0) {
          setIncZones(prev => {
            const updated = [...prev, ...zonesData.zones];
            incZoneCountRef.current = zonesData.total;
            return updated;
          });
          // Enviar zonas parciales al chart
          const manager = getManager();
          if (manager && manager.zoneVisualizerIndicator) {
            // Reconstruir array completo para el chart
            const allZones = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-zones?since=0`);
            const allData = await allZones.json();
            if (allData.zones) {
              manager.zoneVisualizerIndicator.setVPZones(allData.zones);
              if (manager.requestRedraw) manager.requestRedraw();
            }
          }
        }

        // Si termino o se detuvo, parar polling
        if (!statusData.running && (statusData.phase === 'done' || statusData.phase === 'stopped')) {
          if (incPollingRef.current) {
            clearInterval(incPollingRef.current);
            incPollingRef.current = null;
          }
        }
      } catch (e) { /* silencio */ }
    };

    poll(); // Inmediato
    incPollingRef.current = setInterval(poll, 2000);
    return () => {
      if (incPollingRef.current) {
        clearInterval(incPollingRef.current);
        incPollingRef.current = null;
      }
    };
  }, [incRunning, incPhase, getManager]);

  // ---- Incremental detection handlers ----
  const handleIncStart = useCallback(async () => {
    setIncZones([]);
    incZoneCountRef.current = 0;
    setIncStatus(null);
    setIncPhase('fetching');
    setIncRunning(true);
    setIncPaused(false);
    setIncMinimized(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          days: zoneDays,
          config: params,
          chunk_days: 30,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Error iniciando deteccion');
        setIncRunning(false);
        setIncPhase('');
      }
    } catch (e) {
      setError(e.message);
      setIncRunning(false);
      setIncPhase('');
    }
  }, [symbol, interval, zoneDays, params]);

  const handleIncStop = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/zones/vp/incremental-stop`, { method: 'POST' });
    } catch (e) { /* silencio */ }
  }, []);

  const handleIncPause = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/zones/vp/incremental-pause`, { method: 'POST' });
    } catch (e) { /* silencio */ }
  }, []);

  const handleIncResume = useCallback(async () => {
    setIncRunning(true);
    setIncPhase('detecting');
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/incremental-resume`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Error retomando deteccion');
        setIncRunning(false);
      }
    } catch (e) {
      setError(e.message);
      setIncRunning(false);
    }
  }, []);

  // Trades expandidos para zonas incrementales (misma logica que expandedTrades)
  const incExpandedTrades = useMemo(() => {
    if (!incZones || incZones.length === 0) return [];
    const trades = [];
    incZones.forEach((z, zIdx) => {
      if (z.mr_trades && z.mr_trades.length > 0) {
        z.mr_trades.forEach((t, tIdx) => {
          trades.push({
            zoneIndex: zIdx + 1, subIndex: tIdx + 1, label: `#${zIdx + 1}.${tIdx + 1}`,
            direction: t.direction, entry_price: t.entry_price, sl_price: t.sl_price,
            tp_price: t.tp_price, entry_timestamp: t.entry_timestamp,
            trade_close_timestamp: t.trade_close_timestamp,
            trade_result: t.trade_result, trade_pnl_r: t.trade_pnl_r,
            strategy: 'mean_reversion',
          });
        });
      } else if (z.trade_result && z.trade_result !== 'SKIPPED' && z.trade_result !== 'NO_ENTRY' && z.trade_result !== 'NO_BREAKOUT') {
        trades.push({
          zoneIndex: zIdx + 1, subIndex: 0, label: `#${zIdx + 1}`,
          direction: z.breakout_direction, entry_price: z.entry_price,
          sl_price: z.sl_price, tp_price: z.tp_price,
          entry_timestamp: z.entry_timestamp, trade_close_timestamp: z.trade_close_timestamp,
          trade_result: z.trade_result, trade_pnl_r: z.trade_pnl_r,
          strategy: z.entry_strategy || 'breakout',
        });
      }
    });
    return trades;
  }, [incZones]);

  // Ref estable para onRealtimeChange (evita recrear fetchRtStatus en cada render)
  const onRealtimeChangeRef = useRef(onRealtimeChange);
  useEffect(() => { onRealtimeChangeRef.current = onRealtimeChange; }, [onRealtimeChange]);

  // ---- Fetch realtime status ----
  const fetchRtStatus = useCallback(async (syncConfig = false) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/status`);
      const data = await res.json();
      if (data.success) {
        setRtRunning(data.running || false);
        setRtStatus(data);
        if (onRealtimeChangeRef.current) {
          onRealtimeChangeRef.current(data.running);
        }
        // Sync config inputs only when realtime service is actually running
        // (avoid overwriting user params with service defaults when service is stopped)
        if (syncConfig && data.running && data.config) {
          const cfg = data.config;
          const syncable = ['window_size', 'window_step', 'bins', 'va_percent', 'min_d_score',
            'include_pb_shapes', 'min_zone_candles', 'merge_gap', 'max_range_pct',
            'lookforward_bars', 'tp_rr_ratio', 'sl_buffer_pct', 'sl_mode', 'entry_mode',
            'breakout_confirm_bars', 'position_mode', 'warmup_candles',
            'entry_strategy', 'mr_target', 'mr_entry_zone', 'mr_confirm', 'mr_swing_bars', 'mr_sl_mode',
            'mr_sl_buffer_pct', 'mr_min_zone_candles', 'mr_max_trades_per_zone',
            'rt_max_bars', 'rt_level', 'rt_confirm', 'rt_swing_bars', 'rt_sl_mode', 'rt_must_reenter',
            'bo_volume_filter', 'bo_volume_zscore', 'bo_momentum_bars'];
          const updates = {};
          syncable.forEach(k => {
            if (cfg[k] !== undefined) updates[k] = cfg[k];
          });
          if (Object.keys(updates).length > 0) {
            setParams(prev => ({ ...prev, ...updates }));
          }
        }
      }
    } catch (e) {
      console.debug('[VPScanner] Status no disponible:', e.message);
    }
  }, []); // Sin dependencias - usa ref para onRealtimeChange

  // Poll status when open (syncConfig=true solo al abrir, no en polling)
  const didSyncRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      if (!didSyncRef.current) {
        fetchRtStatus(true);
        didSyncRef.current = true;
      }
      rtPollingRef.current = setInterval(() => fetchRtStatus(false), 10000);
    } else {
      didSyncRef.current = false;
    }
    return () => {
      if (rtPollingRef.current) {
        clearInterval(rtPollingRef.current);
        rtPollingRef.current = null;
      }
    };
  }, [isOpen, fetchRtStatus]);

  // ---- Realtime toggle ----
  const handleRtToggle = useCallback(async () => {
    setRtLoading(true);
    try {
      const starting = !rtRunning;
      const endpoint = rtRunning
        ? `${API_BASE_URL}/api/zones/vp/stop`
        : `${API_BASE_URL}/api/zones/vp/start`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRtRunning(starting);
        await fetchRtStatus(true);
        const manager = getManager();
        if (manager) {
          if (starting) {
            manager.startVPZonePolling();
          } else {
            manager.stopVPZonePolling();
          }
        }
      } else {
        console.error('[VPScanner] Error toggle:', data.error);
      }
    } catch (e) {
      console.error('[VPScanner] Error toggle:', e);
    } finally {
      setRtLoading(false);
    }
  }, [rtRunning, fetchRtStatus, getManager]);

  // ---- Save realtime config ----
  const handleRtConfigSave = useCallback(async () => {
    setRtLoading(true);
    setRtMsg(null);
    try {
      const configPayload = {
        enabled: true,
        symbols: [symbol],
        interval: interval,
        ...params,
      };
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configPayload),
      });
      const data = await res.json();
      if (data.success) {
        setRtMsg({ type: 'ok', text: 'Config guardada y re-analisis ejecutado' });
        await fetchRtStatus(true);
      } else {
        setRtMsg({ type: 'error', text: data.error || 'Error guardando config' });
      }
    } catch (e) {
      setRtMsg({ type: 'error', text: e.message });
    } finally {
      setRtLoading(false);
    }
  }, [params, symbol, interval, fetchRtStatus]);

  // ---- Backtest ----
  const handleBacktest = useCallback(async (forceRedetect = false) => {
    setLoading(true);
    setBtProgress(null);
    setStats(null);
    setZones(null);
    setShowTrades(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          days: zoneDays,
          config: params,
          force_redetect: forceRedetect,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStats({ ...data.stats, from_zone_cache: data.from_zone_cache || false });
        setZones(data.zones || []);
        // Guardar params de deteccion del backtest exitoso
        const detParams = {};
        for (const p of DETECTION_PARAMS) {
          detParams[p] = params[p];
        }
        setLastDetectionParams(detParams);
        setLastBacktestMeta({ symbol, interval, days: zoneDays });
        // Enviar zonas al chart
        if (data.zones && data.zones.length > 0) {
          const manager = getManager();
          if (manager && manager.zoneVisualizerIndicator) {
            manager.zoneVisualizerIndicator.setVPZones(data.zones);
            if (manager.requestRedraw) manager.requestRedraw();
          }
        }
      } else {
        setError(data.error || 'Error en backtest');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBtProgress(null);
    }
  }, [params, symbol, interval, zoneDays, getManager]);

  // ---- Optimizer ----
  const optimizableParams = useMemo(() => {
    const fixedParams = [
      { key: 'window_size', label: 'Window Size', min: 10, max: 100, step: 5 },
      { key: 'window_step', label: 'Window Step', min: 1, max: 20, step: 1 },
      { key: 'min_zone_candles', label: 'Min Zone Candles', min: 5, max: 30, step: 5 },
      { key: 'merge_gap', label: 'Merge Gap', min: 0, max: 10, step: 1 },
    ];
    const progParams = [
      { key: 'prog_min_candles', label: 'Min Candles', min: 20, max: 500, step: 20 },
      { key: 'prog_range_pct', label: 'Max Range %', min: 0.5, max: 5.0, step: 0.25 },
      { key: 'prog_degrade_bars', label: 'Degrade Bars', min: 3, max: 15, step: 1 },
      { key: 'prog_close_outside_bars', label: 'Close Outside VA', min: 1, max: 15, step: 1 },
    ];
    const sharedParams = [
      { key: 'bins', label: 'Bins', min: 20, max: 100, step: 10 },
      { key: 'va_percent', label: 'VA %', min: 0.50, max: 0.90, step: 0.05 },
      { key: 'min_d_score', label: 'Min D-Score', min: 20, max: 80, step: 5 },
      { key: 'lookforward_bars', label: 'Lookforward Bars', min: 50, max: 300, step: 25 },
      { key: 'tp_rr_ratio', label: 'TP R:R', min: 1.0, max: 4.0, step: 0.5 },
    ];
    // Parametros especificos de cada estrategia
    const strategyParams = [];
    if (params.entry_strategy === 'breakout') {
      strategyParams.push(
        { key: 'breakout_confirm_bars', label: 'Breakout Confirm', min: 0, max: 5, step: 1 },
        { key: 'bo_volume_zscore', label: 'BO Vol Z-Score', min: 0.5, max: 3.0, step: 0.25 },
        { key: 'bo_momentum_bars', label: 'BO Momentum Bars', min: 0, max: 20, step: 2 },
      );
    } else if (params.entry_strategy === 'retest') {
      strategyParams.push(
        { key: 'breakout_confirm_bars', label: 'Breakout Confirm', min: 0, max: 5, step: 1 },
        { key: 'rt_max_bars', label: 'RT Max Bars', min: 5, max: 100, step: 5 },
        { key: 'rt_swing_bars', label: 'RT Swing Bars', min: 2, max: 10, step: 1 },
      );
    } else if (params.entry_strategy === 'mean_reversion') {
      strategyParams.push(
        { key: 'mr_sl_buffer_pct', label: 'MR SL Buffer %', min: 0.05, max: 0.5, step: 0.05 },
        { key: 'mr_min_zone_candles', label: 'MR Min Zone Candles', min: 5, max: 50, step: 5 },
        { key: 'mr_max_trades_per_zone', label: 'MR Max Trades/Zone', min: 1, max: 10, step: 1 },
      );
    }
    const modeParams = params.detection_mode === 'progressive' ? progParams : fixedParams;
    return [...modeParams, ...sharedParams, ...strategyParams];
  }, [params.detection_mode, params.entry_strategy]);

  const toggleOptParam = useCallback((key) => {
    setOptParamRanges(prev => {
      const updated = { ...prev };
      if (updated[key]) {
        delete updated[key];
      } else {
        const def = optimizableParams.find(p => p.key === key);
        if (def) {
          updated[key] = { min: def.min, max: def.max, step: def.step };
        }
      }
      return updated;
    });
  }, [optimizableParams]);

  const totalOptCombos = useMemo(() => {
    let total = 1;
    Object.values(optParamRanges).forEach(r => {
      const step = r.step > 0 ? r.step : 1;
      const mn = isFinite(r.min) ? r.min : 0;
      const mx = isFinite(r.max) ? r.max : mn;
      if (mx < mn) { total *= 1; return; }
      const count = Math.floor((mx - mn) / step) + 1;
      total *= Math.min(count, 20);
    });
    return Object.keys(optParamRanges).length > 0 ? total : 0;
  }, [optParamRanges]);

  const handleOptEstimate = useCallback(async () => {
    if (totalOptCombos === 0) return;
    setOptLoading(true);
    setOptPhase('estimating');
    setOptEstimate(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, interval, days: zoneDays,
          base_config: params,
          param_ranges: optParamRanges,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOptEstimate(data);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setOptLoading(false);
      setOptPhase(null);
    }
  }, [symbol, interval, zoneDays, params, optParamRanges, totalOptCombos]);

  const handleOptRun = useCallback(async () => {
    setOptLoading(true);
    setOptPhase('running');
    setOptResults(null);
    setOptProgress(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, interval, days: zoneDays,
          base_config: params,
          param_ranges: optParamRanges,
          metric: optMetric,
          top_n: 15,
        }),
        signal: AbortSignal.timeout(10 * 60 * 60 * 1000), // 10 horas
      });
      const data = await res.json();
      if (data.success) {
        setOptResults(data);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setOptLoading(false);
      setOptPhase(null);
      setOptProgress(null);
    }
  }, [symbol, interval, zoneDays, params, optParamRanges, optMetric]);

  // ---- Strategy Optimizer ----
  const strategyOptParams = useMemo(() => {
    // Parametros comunes de trading
    const common = [
      { key: 'tp_rr_ratio', label: 'TP R:R', type: 'range', min: 1.0, max: 5.0, step: 0.5 },
      { key: 'sl_buffer_pct', label: 'SL Buffer %', type: 'range', min: 0.0, max: 0.5, step: 0.05 },
      { key: 'lookforward_bars', label: 'Lookforward Bars', type: 'range', min: 50, max: 300, step: 25 },
      { key: 'breakout_confirm_bars', label: 'Breakout Confirm', type: 'range', min: 0, max: 5, step: 1 },
      { key: 'entry_mode', label: 'Entry Mode', type: 'enum', values: ['zone', 'va'] },
      { key: 'sl_mode', label: 'SL Mode (breakout)', type: 'enum', values: ['beyond_poc', 'below_va', 'zone_opposite'] },
      { key: 'position_mode', label: 'Position Mode', type: 'enum', values: ['sequential', 'concurrent'] },
    ];
    // Breakout
    const breakoutP = [
      { key: 'bo_volume_zscore', label: 'BO Vol Z-Score', type: 'range', min: 0.5, max: 3.0, step: 0.25 },
      { key: 'bo_momentum_bars', label: 'BO Momentum Bars', type: 'range', min: 0, max: 20, step: 2 },
    ];
    // Retest
    const retestP = [
      { key: 'rt_max_bars', label: 'RT Max Bars', type: 'range', min: 5, max: 100, step: 5 },
      { key: 'rt_level', label: 'RT Level', type: 'enum', values: ['va', 'zone', 'poc'] },
      { key: 'rt_confirm', label: 'RT Confirm', type: 'enum', values: ['touch', 'rejection', 'swing'] },
      { key: 'rt_swing_bars', label: 'RT Swing Bars', type: 'range', min: 2, max: 10, step: 1 },
      { key: 'rt_sl_mode', label: 'RT SL Mode', type: 'enum', values: ['below_retest', 'beyond_poc', 'below_va', 'below_zone'] },
      { key: 'rt_must_reenter', label: 'RT Must Re-enter', type: 'enum', values: [true, false] },
    ];
    // Mean Reversion
    const mrP = [
      { key: 'mr_target', label: 'MR Target', type: 'enum', values: ['poc', 'opposite_va', 'opposite_zone'] },
      { key: 'mr_entry_zone', label: 'MR Entry Zone', type: 'enum', values: ['va', 'zone'] },
      { key: 'mr_confirm', label: 'MR Confirm', type: 'enum', values: ['touch', 'rejection', 'swing'] },
      { key: 'mr_swing_bars', label: 'MR Swing Bars', type: 'range', min: 2, max: 10, step: 1 },
      { key: 'mr_sl_mode', label: 'MR SL Mode', type: 'enum', values: ['beyond_zone', 'beyond_va'] },
      { key: 'mr_sl_buffer_pct', label: 'MR SL Buffer %', type: 'range', min: 0.05, max: 0.5, step: 0.05 },
      { key: 'mr_min_zone_candles', label: 'MR Min Zone Candles', type: 'range', min: 5, max: 50, step: 5 },
      { key: 'mr_max_trades_per_zone', label: 'MR Max Trades/Zone', type: 'range', min: 1, max: 10, step: 1 },
    ];

    const result = [...common];
    if (soStrategies.includes('breakout') || soStrategies.length > 1) result.push(...breakoutP);
    if (soStrategies.includes('retest') || soStrategies.length > 1) result.push(...retestP);
    if (soStrategies.includes('mean_reversion') || soStrategies.length > 1) result.push(...mrP);
    return result;
  }, [soStrategies]);

  const toggleSoParam = useCallback((key) => {
    setSoParamRanges(prev => {
      const updated = { ...prev };
      if (updated[key]) {
        delete updated[key];
      } else {
        const def = strategyOptParams.find(p => p.key === key);
        if (def) {
          if (def.type === 'enum') {
            updated[key] = { type: 'enum', values: def.values };
          } else {
            updated[key] = { min: def.min, max: def.max, step: def.step };
          }
        }
      }
      return updated;
    });
  }, [strategyOptParams]);

  const toggleSoStrategy = useCallback((strat) => {
    setSoStrategies(prev => {
      if (prev.includes(strat)) {
        return prev.length > 1 ? prev.filter(s => s !== strat) : prev;
      }
      return [...prev, strat];
    });
  }, []);

  const totalSoCombos = useMemo(() => {
    let total = 1;
    Object.values(soParamRanges).forEach(r => {
      if (r.type === 'enum' || r.values) {
        total *= Math.max((r.values || []).length, 1);
      } else {
        const step = r.step > 0 ? r.step : 1;
        const mn = isFinite(r.min) ? r.min : 0;
        const mx = isFinite(r.max) ? r.max : mn;
        if (mx < mn) { total *= 1; return; }
        const count = Math.floor((mx - mn) / step) + 1;
        total *= Math.min(count, 20);
      }
    });
    // Multiplicar por estrategias si son mas de 1
    if (soStrategies.length > 1) total *= soStrategies.length;
    return Object.keys(soParamRanges).length > 0 || soStrategies.length > 1 ? total : 0;
  }, [soParamRanges, soStrategies]);

  const handleSoEstimate = useCallback(async () => {
    if (totalSoCombos === 0) return;
    setSoLoading(true);
    setSoPhase('estimating');
    setSoEstimate(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize-strategy-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, interval, days: zoneDays,
          base_config: params,
          param_ranges: soParamRanges,
          entry_strategies: soStrategies.length > 1 ? soStrategies : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSoEstimate(data);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSoLoading(false);
      setSoPhase(null);
    }
  }, [symbol, interval, zoneDays, params, soParamRanges, soStrategies, totalSoCombos]);

  const handleSoRun = useCallback(async () => {
    setSoLoading(true);
    setSoPhase('running');
    setSoResults(null);
    setSoProgress(null);

    // Polling de progreso
    if (soProgressRef.current) clearInterval(soProgressRef.current);
    soProgressRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize-strategy-progress`);
        const data = await res.json();
        if (data.running) {
          setSoProgress(data);
        }
      } catch (_) {}
    }, 2000);

    try {
      const res = await fetch(`${API_BASE_URL}/api/zones/vp/optimize-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, interval, days: zoneDays,
          base_config: params,
          param_ranges: soParamRanges,
          entry_strategies: soStrategies.length > 1 ? soStrategies : null,
          metric: soMetric,
          top_n: 15,
        }),
        signal: AbortSignal.timeout(10 * 60 * 60 * 1000),
      });
      const data = await res.json();
      if (data.success) {
        setSoResults(data);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSoLoading(false);
      setSoPhase(null);
      setSoProgress(null);
      if (soProgressRef.current) { clearInterval(soProgressRef.current); soProgressRef.current = null; }
    }
  }, [symbol, interval, zoneDays, params, soParamRanges, soStrategies, soMetric]);

  // Helper: formato de tiempo legible
  const formatTime = (seconds) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // ---- Render ----

  // Barra flotante minimizada (visible aunque isOpen=false si hay deteccion corriendo/detenida)
  const showFloatingBar = incMinimized && (incRunning || incPhase === 'stopped' || incPhase === 'done');

  if (!isOpen && !showFloatingBar) return null;

  // Si esta minimizado, mostrar solo la barra flotante
  if (!isOpen && showFloatingBar) {
    const phaseLabel = incPhase === 'fetching' ? 'Descargando...'
      : incPhase === 'detecting' ? `Chunk ${incStatus?.current_chunk || 0}/${incStatus?.total_chunks || 0}`
      : incPhase === 'paused' ? 'Pausado'
      : incPhase === 'stopped' ? 'Detenido'
      : incPhase === 'done' ? 'Completado' : '';
    const pct = incStatus?.total_chunks > 0
      ? Math.round((incStatus.chunks_completed || 0) / incStatus.total_chunks * 100) : 0;
    return (
      <div style={{
        position: 'fixed', bottom: '16px', right: '16px', zIndex: 10001,
        backgroundColor: '#1a1a2e', border: '1px solid rgba(0,86,210,0.5)',
        borderRadius: '10px', padding: '10px 16px', minWidth: '320px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', cursor: 'pointer',
      }} onClick={() => { setIncMinimized(false); if (onOpen) onOpen(); }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: '#e0e0e0', fontWeight: 600 }}>
            VP Incremental - {incStatus?.symbol || symbol}
          </div>
          <div style={{ fontSize: '11px', color: incPhase === 'done' ? '#4CAF50' : incPhase === 'stopped' ? '#FF9800' : '#0090FF' }}>
            {phaseLabel}
          </div>
          <div style={{ fontSize: '12px', color: '#FF9800', fontWeight: 600 }}>
            {incZones.length} zonas
          </div>
        </div>
        {incRunning && (
          <div style={{ marginTop: '6px', width: '100%', height: '4px', backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: 'linear-gradient(90deg, #0056D2, #4CAF50)',
              transition: 'width 0.5s ease',
            }} />
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', textAlign: 'center' }}>
          Click para expandir
        </div>
      </div>
    );
  }

  const tabBtn = (id, label) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      style={{
        padding: '8px 16px',
        backgroundColor: activeTab === id ? '#0056D2' : 'rgba(255,255,255,0.08)',
        color: activeTab === id ? 'white' : '#aaa',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: activeTab === id ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <>
    <style>{`
      @keyframes vpBtIndeterminate {
        0% { left: -40%; }
        100% { left: 100%; }
      }
    `}</style>
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
      alignItems: 'center', zIndex: 10000,
    }}>
      <div style={{
        backgroundColor: '#1a1a2e', color: '#e0e0e0', borderRadius: '12px',
        width: '680px', maxHeight: '90vh', overflow: 'auto',
        padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        border: '1px solid rgba(0,86,210,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0056D2' }}>
              VP Zone Scanner
            </h2>
            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
              {symbol} @ {interval}m | Deteccion por Volume Profile
            </div>
          </div>
          <button onClick={() => {
              if (incRunning) {
                setIncMinimized(true);
                onClose();
              } else {
                onClose();
              }
            }} style={{
            background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer',
          }}>{incRunning ? '_' : 'x'}</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {tabBtn('backtest', 'Backtest')}
          {tabBtn('realtime', 'Tiempo Real')}
          {tabBtn('optimizer', 'Opt. Zonas')}
          {tabBtn('strat_optimizer', 'Opt. Estrategia')}
        </div>

        {/* Error display */}
        {error && (
          <div style={{ padding: '8px 12px', backgroundColor: 'rgba(220,53,69,0.2)', borderRadius: '6px',
            color: '#ff6b6b', fontSize: '12px', marginBottom: '12px' }}>
            {error}
            <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>x</button>
          </div>
        )}

        {/* ====================== BACKTEST TAB ====================== */}
        {activeTab === 'backtest' && (
          <div>
            {/* Detection Mode */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Metodo de Deteccion</h4>
              <select value={params.detection_mode} onChange={e => {
                  handleParamChange('detection_mode', e.target.value);
                  setOptParamRanges({}); // Limpiar params del optimizador al cambiar modo
                }}
                style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
                <option value="fixed_window">Ventana Fija (clasico)</option>
                <option value="progressive">Progresivo (D creciente)</option>
              </select>
              <div style={{ fontSize: '11px', color: '#777', lineHeight: '1.4' }}>
                {params.detection_mode === 'progressive'
                  ? 'Expande la ventana vela a vela mientras el perfil D engorda. Detecta zonas de duracion variable.'
                  : 'Escanea con ventana de tamano fijo y paso definido. Metodo probado.'}
              </div>
            </div>

            {/* Presets */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#8E24AA' }}>
                Presets ({params.detection_mode === 'progressive' ? 'Progresivo' : 'Ventana Fija'})
              </h4>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                <select value={selectedPreset} onChange={e => handleLoadPreset(e.target.value)}
                  style={{ flex: 1, padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                  <option value="">-- Seleccionar preset --</option>
                  {Object.keys(presets).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {selectedPreset && (
                  <button onClick={() => handleDeletePreset(selectedPreset)}
                    style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white',
                      border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                    Eliminar
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
                  placeholder="Nombre del preset..." maxLength={40}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
                  style={{ flex: 1, padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }} />
                <button onClick={handleSavePreset} disabled={!presetName.trim()}
                  style={{ padding: '5px 12px', backgroundColor: presetName.trim() ? '#8E24AA' : '#555',
                    color: 'white', border: 'none', borderRadius: '4px', cursor: presetName.trim() ? 'pointer' : 'default',
                    fontSize: '11px', whiteSpace: 'nowrap', opacity: presetName.trim() ? 1 : 0.5 }}>
                  Guardar
                </button>
              </div>
              {presetMsg && (
                <div style={{ marginTop: '6px', fontSize: '11px',
                  color: presetMsg.type === 'ok' ? '#4CAF50' : '#ff6b6b' }}>
                  {presetMsg.text}
                </div>
              )}
            </div>

            {/* VP Parameters - Fixed Window */}
            {params.detection_mode === 'fixed_window' && (
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Volume Profile</h4>

              <div style={labelStyle}>
                <span>Window Size (velas)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.window_size}</span>
              </div>
              <input type="range" min={10} max={100} step={5} value={params.window_size}
                onChange={e => handleParamChange('window_size', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Window Step</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.window_step}</span>
              </div>
              <input type="range" min={1} max={20} step={1} value={params.window_step}
                onChange={e => handleParamChange('window_step', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Bins (resolucion)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.bins}</span>
              </div>
              <input type="range" min={20} max={100} step={5} value={params.bins}
                onChange={e => handleParamChange('bins', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Value Area %</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{(params.va_percent * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0.50} max={0.90} step={0.05} value={params.va_percent}
                onChange={e => handleParamChange('va_percent', e.target.value)} style={sliderStyle} />
            </div>
            )}

            {/* VP Parameters - Progressive */}
            {params.detection_mode === 'progressive' && (
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Deteccion Progresiva</h4>

              <div style={labelStyle}>
                <span>Min Candles (inicio)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.prog_min_candles}</span>
              </div>
              <input type="range" min={10} max={500} step={10} value={params.prog_min_candles}
                onChange={e => handleParamChange('prog_min_candles', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Max Range %</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.prog_range_pct}%</span>
              </div>
              <input type="range" min={0.5} max={5.0} step={0.1} value={params.prog_range_pct}
                onChange={e => handleParamChange('prog_range_pct', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Bins (resolucion)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.bins}</span>
              </div>
              <input type="range" min={20} max={100} step={5} value={params.bins}
                onChange={e => handleParamChange('bins', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Value Area %</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{(params.va_percent * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0.50} max={0.90} step={0.05} value={params.va_percent}
                onChange={e => handleParamChange('va_percent', e.target.value)} style={sliderStyle} />

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Cierre de zona</div>
                  <select value={params.prog_stop_mode} onChange={e => handleParamChange('prog_stop_mode', e.target.value)}
                    style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                    <option value="breakout">Breakout (precio sale del rango)</option>
                    <option value="degradation">Degradacion (score baja)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Metrica de grosor</div>
                  <select value={params.prog_thickness_metric} onChange={e => handleParamChange('prog_thickness_metric', e.target.value)}
                    style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                    <option value="kurtosis">Kurtosis (concentracion central)</option>
                    <option value="poc_ratio">POC Ratio (prominencia del POC)</option>
                  </select>
                </div>
              </div>

              {params.prog_stop_mode === 'degradation' && (
                <>
                  <div style={{ ...labelStyle, marginTop: '8px' }}>
                    <span>Degrade Bars (velas de caida)</span>
                    <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.prog_degrade_bars}</span>
                  </div>
                  <input type="range" min={3} max={15} step={1} value={params.prog_degrade_bars}
                    onChange={e => handleParamChange('prog_degrade_bars', e.target.value)} style={sliderStyle} />
                </>
              )}

              <div style={{ ...labelStyle, marginTop: '8px' }}>
                <span>Cierres fuera de {params.prog_close_reference === 'zone' ? 'zona' : 'VA'} para cerrar</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.prog_close_outside_bars}</span>
              </div>
              <input type="range" min={1} max={15} step={1} value={params.prog_close_outside_bars}
                onChange={e => handleParamChange('prog_close_outside_bars', e.target.value)} style={sliderStyle} />

              <div style={{ ...labelStyle, marginTop: '6px' }}>
                <span>Referencia de cierre</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {['va', 'zone'].map(ref => (
                    <button key={ref}
                      onClick={() => handleParamChange('prog_close_reference', ref)}
                      style={{
                        padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
                        border: params.prog_close_reference === ref ? '1px solid #0056D2' : '1px solid #555',
                        borderRadius: '3px',
                        background: params.prog_close_reference === ref ? '#0056D2' : 'transparent',
                        color: params.prog_close_reference === ref ? '#fff' : '#aaa',
                      }}
                    >{ref === 'va' ? 'Value Area' : 'Zona completa'}</button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                VA = cierra antes (mas zonas). Zona = mas permisivo (menos zonas, mas largas)
              </div>
            </div>
            )}

            {/* D-Score & Shape */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Forma D & Clasificacion</h4>

              <div style={labelStyle}>
                <span>Min D-Score</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.min_d_score}</span>
              </div>
              <input type="range" min={10} max={90} step={5} value={params.min_d_score}
                onChange={e => handleParamChange('min_d_score', e.target.value)} style={sliderStyle} />

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '8px' }}>
                <input type="checkbox" checked={params.include_pb_shapes}
                  onChange={e => handleParamChange('include_pb_shapes', e.target.checked)} />
                Incluir perfiles P/b (extraer D interna)
              </label>

              <div style={labelStyle}>
                <span>Min Zone Candles</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.min_zone_candles}</span>
              </div>
              <input type="range" min={3} max={50} step={1} value={params.min_zone_candles}
                onChange={e => handleParamChange('min_zone_candles', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>Merge Gap (velas)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.merge_gap}</span>
              </div>
              <input type="range" min={0} max={15} step={1} value={params.merge_gap}
                onChange={e => handleParamChange('merge_gap', e.target.value)} style={sliderStyle} />
            </div>

            {/* Trade Simulation */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Simulacion de Trade</h4>

              <div style={labelStyle}>
                <span>Lookforward Bars</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.lookforward_bars}</span>
              </div>
              <input type="range" min={20} max={300} step={10} value={params.lookforward_bars}
                onChange={e => handleParamChange('lookforward_bars', e.target.value)} style={sliderStyle} />

              <div style={labelStyle}>
                <span>TP Risk:Reward</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.tp_rr_ratio}R</span>
              </div>
              <input type="range" min={1.0} max={5.0} step={0.5} value={params.tp_rr_ratio}
                onChange={e => handleParamChange('tp_rr_ratio', e.target.value)} style={sliderStyle} />

              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Position Mode</div>
                  <select value={params.position_mode} onChange={e => handleParamChange('position_mode', e.target.value)}
                    style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                    <option value="sequential">Sequential</option>
                    <option value="concurrent">Concurrent</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Max Price Range %</div>
                  <input type="number" step={0.1} min={0.1} max={10} value={params.max_range_pct}
                    onChange={e => handleParamChange('max_range_pct', e.target.value)}
                    style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }} />
                </div>
              </div>
            </div>

            {/* Estrategia de Trading */}
            <div style={{ ...sectionStyle, border: '1px solid rgba(255,152,0,0.25)' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#FF9800' }}>Estrategia de Trading</h4>
              <select value={params.entry_strategy} onChange={e => handleParamChange('entry_strategy', e.target.value)}
                style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                  border: '1px solid rgba(255,152,0,0.3)', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
                <option value="breakout">Breakout (salida de zona)</option>
                <option value="retest">Retest (breakout + pullback)</option>
                <option value="mean_reversion">Mean Reversion (compra en extremos)</option>
              </select>
              <div style={{ fontSize: '11px', color: '#777', lineHeight: '1.4', marginBottom: '10px' }}>
                {params.entry_strategy === 'breakout' && 'Entra al romperse la zona. Filtros opcionales de volumen y momentum.'}
                {params.entry_strategy === 'retest' && 'Espera breakout, luego pullback al nivel para confirmar soporte/resistencia.'}
                {params.entry_strategy === 'mean_reversion' && 'Compra en VAL, vende en VAH/POC. Multiples trades por zona.'}
              </div>

              {/* ---- BREAKOUT params ---- */}
              {params.entry_strategy === 'breakout' && (
                <div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Entry Mode</div>
                      <select value={params.entry_mode} onChange={e => handleParamChange('entry_mode', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="va">Value Area Breakout</option>
                        <option value="zone">Zone Range Breakout</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>SL Mode</div>
                      <select value={params.sl_mode} onChange={e => handleParamChange('sl_mode', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="beyond_poc">Beyond POC</option>
                        <option value="below_va">Below Value Area</option>
                        <option value="zone_opposite">Zone Opposite</option>
                      </select>
                    </div>
                  </div>

                  <div style={labelStyle}>
                    <span>Breakout Confirm Bars</span>
                    <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.breakout_confirm_bars}{params.breakout_confirm_bars === 0 ? ' (close)' : ''}</span>
                  </div>
                  <input type="range" min={0} max={5} step={1} value={params.breakout_confirm_bars}
                    onChange={e => handleParamChange('breakout_confirm_bars', e.target.value)} style={sliderStyle} />

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '8px' }}>
                    <input type="checkbox" checked={params.bo_volume_filter}
                      onChange={e => handleParamChange('bo_volume_filter', e.target.checked)} />
                    Filtro de volumen en breakout
                  </label>
                  {params.bo_volume_filter && (
                    <div style={{ marginLeft: '24px', marginTop: '4px' }}>
                      <div style={labelStyle}>
                        <span>Min Volume Z-Score</span>
                        <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.bo_volume_zscore}</span>
                      </div>
                      <input type="range" min={0.5} max={3.0} step={0.25} value={params.bo_volume_zscore}
                        onChange={e => handleParamChange('bo_volume_zscore', e.target.value)} style={sliderStyle} />
                    </div>
                  )}

                  <div style={labelStyle}>
                    <span>Momentum Bars (0=off)</span>
                    <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.bo_momentum_bars}</span>
                  </div>
                  <input type="range" min={0} max={20} step={1} value={params.bo_momentum_bars}
                    onChange={e => handleParamChange('bo_momentum_bars', e.target.value)} style={sliderStyle} />
                </div>
              )}

              {/* ---- RETEST params ---- */}
              {params.entry_strategy === 'retest' && (
                <div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Entry Mode (breakout)</div>
                      <select value={params.entry_mode} onChange={e => handleParamChange('entry_mode', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="va">Value Area Breakout</option>
                        <option value="zone">Zone Range Breakout</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Nivel de Retest</div>
                      <select value={params.rt_level} onChange={e => handleParamChange('rt_level', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="va">Value Area (VAH/VAL)</option>
                        <option value="zone">Borde de Zona</option>
                        <option value="poc">POC</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Confirmacion</div>
                      <select value={params.rt_confirm} onChange={e => handleParamChange('rt_confirm', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="touch">Touch (inmediato)</option>
                        <option value="rejection">Rejection (cierra dentro)</option>
                        <option value="swing">Swing (N-bar pivot)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>SL Mode</div>
                      <select value={params.rt_sl_mode} onChange={e => handleParamChange('rt_sl_mode', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="below_retest">Below Retest (mas ajustado)</option>
                        <option value="beyond_poc">Beyond POC</option>
                        <option value="below_va">Below Value Area</option>
                        <option value="below_zone">Below Zone</option>
                      </select>
                    </div>
                  </div>

                  <div style={labelStyle}>
                    <span>Max Bars para Retest</span>
                    <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.rt_max_bars}</span>
                  </div>
                  <input type="range" min={5} max={100} step={5} value={params.rt_max_bars}
                    onChange={e => handleParamChange('rt_max_bars', e.target.value)} style={sliderStyle} />

                  {params.rt_confirm === 'swing' && (
                    <>
                      <div style={labelStyle}>
                        <span>Swing Bars (N a cada lado)</span>
                        <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.rt_swing_bars}</span>
                      </div>
                      <input type="range" min={2} max={10} step={1} value={params.rt_swing_bars}
                        onChange={e => handleParamChange('rt_swing_bars', e.target.value)} style={sliderStyle} />
                    </>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '8px' }}>
                    <input type="checkbox" checked={params.rt_must_reenter}
                      onChange={e => handleParamChange('rt_must_reenter', e.target.checked)} />
                    Retest debe re-entrar a la zona/VA
                  </label>

                  <div style={labelStyle}>
                    <span>Breakout Confirm Bars</span>
                    <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.breakout_confirm_bars}{params.breakout_confirm_bars === 0 ? ' (close)' : ''}</span>
                  </div>
                  <input type="range" min={0} max={5} step={1} value={params.breakout_confirm_bars}
                    onChange={e => handleParamChange('breakout_confirm_bars', e.target.value)} style={sliderStyle} />
                </div>
              )}

              {/* ---- MEAN REVERSION params ---- */}
              {params.entry_strategy === 'mean_reversion' && (
                <div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Zona de Entry</div>
                      <select value={params.mr_entry_zone} onChange={e => handleParamChange('mr_entry_zone', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="va">Value Area (VAH/VAL)</option>
                        <option value="zone">Rango completo de zona</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Target (TP)</div>
                      <select value={params.mr_target} onChange={e => handleParamChange('mr_target', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="poc">POC (centro)</option>
                        <option value="opposite_va">VA opuesto</option>
                        <option value="opposite_zone">Borde opuesto de zona</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Confirmacion</div>
                      <select value={params.mr_confirm} onChange={e => handleParamChange('mr_confirm', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="touch">Touch (inmediato)</option>
                        <option value="rejection">Rejection (cierra dentro)</option>
                        <option value="swing">Swing (N velas confirman giro)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>SL Mode</div>
                      <select value={params.mr_sl_mode} onChange={e => handleParamChange('mr_sl_mode', e.target.value)}
                        style={{ width: '100%', padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="beyond_zone">Beyond Zone (conservador)</option>
                        <option value="beyond_va">Beyond VA (ajustado)</option>
                      </select>
                    </div>
                  </div>

                  {params.mr_confirm === 'swing' && (
                    <>
                      <div style={labelStyle}>
                        <span>Swing Bars (N a cada lado)</span>
                        <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.mr_swing_bars}</span>
                      </div>
                      <input type="range" min={2} max={10} step={1} value={params.mr_swing_bars}
                        onChange={e => handleParamChange('mr_swing_bars', e.target.value)} style={sliderStyle} />
                    </>
                  )}

                  <div style={labelStyle}>
                    <span>SL Buffer %</span>
                    <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.mr_sl_buffer_pct}%</span>
                  </div>
                  <input type="range" min={0.05} max={0.5} step={0.05} value={params.mr_sl_buffer_pct}
                    onChange={e => handleParamChange('mr_sl_buffer_pct', e.target.value)} style={sliderStyle} />

                  <div style={labelStyle}>
                    <span>Min Candles antes de buscar entries</span>
                    <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.mr_min_zone_candles}</span>
                  </div>
                  <input type="range" min={5} max={50} step={5} value={params.mr_min_zone_candles}
                    onChange={e => handleParamChange('mr_min_zone_candles', e.target.value)} style={sliderStyle} />

                  <div style={labelStyle}>
                    <span>Max Trades por Zona</span>
                    <span style={{ color: '#FF9800', fontWeight: 600 }}>{params.mr_max_trades_per_zone}</span>
                  </div>
                  <input type="range" min={1} max={10} step={1} value={params.mr_max_trades_per_zone}
                    onChange={e => handleParamChange('mr_max_trades_per_zone', e.target.value)} style={sliderStyle} />
                </div>
              )}
            </div>

            {/* Days + Run */}
            <div style={sectionStyle}>
              <div style={labelStyle}>
                <span>Dias de historico</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{zoneDays} dias (max {maxDays})</span>
              </div>
              <input type="range" min={1} max={maxDays} step={1} value={zoneDays}
                onChange={e => setZoneDays(Number(e.target.value))} style={sliderStyle} />

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
                <button onClick={() => handleBacktest(false)} disabled={loading} style={{
                  ...btnPrimary, opacity: loading ? 0.6 : 1, flex: 1,
                  backgroundColor: isStrategyOnlyChange ? '#2E7D32' : '#0056D2',
                }}>
                  {loading ? 'Analizando...' : isStrategyOnlyChange
                    ? 'Re-simular Estrategia (rapido)'
                    : 'Detectar Zonas VP'}
                </button>
                {isStrategyOnlyChange && (
                  <button onClick={() => handleBacktest(true)} disabled={loading} style={{
                    ...btnSecondary, opacity: loading ? 0.6 : 1, fontSize: '11px',
                  }}
                    title="Ignora el cache de zonas y ejecuta deteccion completa">
                    Forzar Re-deteccion
                  </button>
                )}
                <button onClick={() => { setParams(defaultParams); setZoneDays(defaultDays); }} style={btnSecondary}>
                  Reset
                </button>
              </div>
              {isStrategyOnlyChange && !loading && (
                <div style={{ fontSize: '11px', color: '#4CAF50', marginTop: '6px', padding: '4px 8px',
                  backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: '4px', border: '1px solid rgba(76,175,80,0.2)' }}>
                  Solo cambiaron parametros de estrategia. Las zonas se cargan del cache (segundos).
                </div>
              )}

              {/* Banner de estado incremental guardado */}
              {incSavedState && incZones.length === 0 && !incRunning && (
                <div style={{
                  marginTop: '8px', padding: '10px 12px',
                  backgroundColor: 'rgba(123,31,162,0.12)',
                  border: '1px solid rgba(123,31,162,0.3)',
                  borderRadius: '6px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#CE93D8' }}>
                      Zonas guardadas encontradas
                    </span>
                    <span style={{ fontSize: '10px', color: '#888' }}>
                      {incSavedState.age_hours < 1
                        ? `hace ${Math.round(incSavedState.age_hours * 60)} min`
                        : `hace ${incSavedState.age_hours.toFixed(0)}h`}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '8px' }}>
                    {incSavedState.zones_count} zonas ({incSavedState.chunks_completed}/{incSavedState.total_chunks} chunks
                    {incSavedState.is_complete ? ' - completo' : ' - parcial'})
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleLoadSavedState} disabled={incLoadingState}
                      style={{
                        ...btnPrimary, flex: 1, fontSize: '12px',
                        backgroundColor: '#7B1FA2',
                        opacity: incLoadingState ? 0.6 : 1,
                      }}>
                      {incLoadingState ? 'Cargando...' : 'Cargar zonas guardadas'}
                    </button>
                    <button onClick={() => setIncSavedState(null)}
                      style={{ ...btnSecondary, fontSize: '11px', padding: '6px 12px' }}>
                      Ignorar
                    </button>
                  </div>
                </div>
              )}

              {/* Boton Deteccion Incremental */}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button onClick={handleIncStart} disabled={loading || incRunning}
                  style={{
                    ...btnPrimary, width: '100%', opacity: (loading || incRunning) ? 0.6 : 1,
                    backgroundColor: '#7B1FA2',
                    fontSize: '12px',
                  }}
                  title="Detecta zonas desde las mas recientes a las antiguas, mostrando progreso en el chart">
                  {incRunning ? 'Deteccion incremental en curso...' : 'Deteccion Incremental (reciente a antiguo)'}
                </button>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                  Detecta por chunks. Puedes minimizar el modal y ver las zonas aparecer en el chart.
                </div>
              </div>
            </div>

            {/* Barra de progreso del backtest */}
            {loading && btProgress && btProgress.running && (
              <div style={{
                padding: '12px', borderRadius: '8px',
                backgroundColor: 'rgba(0, 86, 210, 0.1)',
                border: '1px solid rgba(0, 86, 210, 0.3)',
                marginBottom: '12px',
              }}>
                {/* Fase actual */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ color: '#e0e0e0' }}>
                    {btProgress.phase === 'fetching' && 'Descargando datos historicos...'}
                    {btProgress.phase === 'detecting' && (btProgress.total > 0
                      ? `Detectando zonas: ${(btProgress.current || 0).toLocaleString()} / ${btProgress.total.toLocaleString()}`
                      : 'Iniciando deteccion...'
                    )}
                    {btProgress.phase === 'simulating' && `Simulando trades: ${btProgress.zones_found} zonas`}
                  </span>
                  {btProgress.total > 0 && (
                    <span style={{ color: '#4CAF50' }}>
                      {Math.round((btProgress.current || 0) / btProgress.total * 100)}%
                    </span>
                  )}
                </div>

                {/* Barra visual */}
                {btProgress.phase === 'fetching' ? (
                  <div style={{
                    width: '100%', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '5px', overflow: 'hidden', position: 'relative',
                  }}>
                    <div style={{
                      width: '40%', height: '100%',
                      background: 'linear-gradient(90deg, transparent, #0056D2, #4CAF50, transparent)',
                      borderRadius: '5px',
                      position: 'absolute',
                      animation: 'vpBtIndeterminate 1.5s ease-in-out infinite',
                    }} />
                  </div>
                ) : btProgress.total > 0 ? (
                  <div style={{
                    width: '100%', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '5px', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.round((btProgress.current || 0) / btProgress.total * 100)}%`,
                      height: '100%',
                      background: btProgress.phase === 'simulating'
                        ? 'linear-gradient(90deg, #FF9800, #4CAF50)'
                        : 'linear-gradient(90deg, #0056D2, #4CAF50)',
                      borderRadius: '5px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                ) : null}

                {/* Tiempos */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: '#888' }}>
                  <span>Transcurrido: {formatTime(btProgress.elapsed || 0)}</span>
                  {btProgress.estimated_remaining > 0 && (
                    <span>~{formatTime(btProgress.estimated_remaining)} restante</span>
                  )}
                </div>

                {/* Zonas encontradas */}
                {btProgress.zones_found > 0 && btProgress.phase === 'detecting' && (
                  <div style={{ fontSize: '11px', marginTop: '2px', color: '#FF9800' }}>
                    {btProgress.zones_found} zonas encontradas hasta ahora
                  </div>
                )}
              </div>
            )}

            {/* Stats result */}
            {stats && (
              <div style={{ ...sectionStyle, backgroundColor: 'rgba(0,86,210,0.1)' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>
                  Resultados
                  {stats.entry_strategy && (
                    <span style={{ fontSize: '11px', color: '#FF9800', marginLeft: '8px', fontWeight: 400 }}>
                      [{stats.entry_strategy}]
                    </span>
                  )}
                  {stats.from_zone_cache && (
                    <span style={{ fontSize: '10px', color: '#4CAF50', marginLeft: '8px', fontWeight: 400,
                      padding: '1px 6px', backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: '3px' }}>
                      desde cache
                    </span>
                  )}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '12px' }}>
                  <div><span style={{ color: '#888' }}>Zonas:</span> <strong>{stats.total_zones}</strong></div>
                  {stats.total_trades != null && stats.total_trades !== stats.total_zones && (
                    <div><span style={{ color: '#888' }}>Trades:</span> <strong>{stats.total_trades}</strong></div>
                  )}
                  <div><span style={{ color: '#888' }}>Wins:</span> <strong style={{ color: '#4CAF50' }}>{stats.wins}</strong></div>
                  <div><span style={{ color: '#888' }}>Losses:</span> <strong style={{ color: '#dc3545' }}>{stats.losses}</strong></div>
                  <div><span style={{ color: '#888' }}>Open:</span> <strong style={{ color: '#FFA500' }}>{stats.open || 0}</strong></div>
                  <div><span style={{ color: '#888' }}>Win Rate:</span> <strong>{stats.win_rate?.toFixed(1)}%</strong></div>
                  <div><span style={{ color: '#888' }}>PnL:</span> <strong style={{ color: stats.total_pnl_r >= 0 ? '#4CAF50' : '#dc3545' }}>{stats.total_pnl_r?.toFixed(1)}R</strong></div>
                  <div><span style={{ color: '#888' }}>Expect:</span> <strong>{stats.expectancy?.toFixed(2)}R</strong></div>
                  <div><span style={{ color: '#888' }}>PF:</span> <strong>{stats.profit_factor?.toFixed(2)}</strong></div>
                  {params.detection_mode === 'progressive' && stats.avg_progressive_quality > 0 && (
                    <div><span style={{ color: '#888' }}>Prog Quality:</span> <strong style={{ color: '#FF9800' }}>{stats.avg_progressive_quality?.toFixed(1)}</strong></div>
                  )}
                  {params.detection_mode === 'progressive' && stats.zones_x_quality > 0 && (
                    <div><span style={{ color: '#888' }}>Zones x Quality:</span> <strong style={{ color: '#CE93D8' }}>{stats.zones_x_quality?.toFixed(0)}</strong></div>
                  )}
                </div>
              </div>
            )}

            {/* Trade list toggle + table */}
            {stats && expandedTrades.length > 0 && (
              <div style={sectionStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', color: '#FF9800' }}>
                    Trades ({expandedTrades.length})
                  </h4>
                  <button onClick={() => setShowTrades(prev => !prev)} style={{
                    padding: '4px 12px', backgroundColor: showTrades ? '#555' : '#FF9800', color: 'white',
                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px',
                  }}>
                    {showTrades ? 'Ocultar' : 'Ver Trades'}
                  </button>
                </div>

                {showTrades && (
                  <div style={{ marginTop: '8px', maxHeight: '300px', overflow: 'auto' }}>
                    <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                          <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>#</th>
                          <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>Dir</th>
                          <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>Entry</th>
                          <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>SL</th>
                          <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>TP</th>
                          <th style={{ padding: '4px', textAlign: 'center', color: '#888' }}>Result</th>
                          <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>PnL R</th>
                          <th style={{ padding: '4px', textAlign: 'center', color: '#888' }}>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedTrades.map((t, i) => {
                          const resultColor = t.trade_result === 'WIN' ? '#4CAF50'
                            : t.trade_result === 'LOSS' ? '#dc3545'
                            : t.trade_result === 'OPEN' ? '#FFA500' : '#888';
                          const dateStr = t.entry_timestamp
                            ? new Date(t.entry_timestamp).toLocaleDateString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                            : '';
                          return (
                            <tr key={i}
                              onClick={() => t.entry_timestamp && handleNavigateToTrade(t.entry_timestamp)}
                              style={{
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                cursor: t.entry_timestamp ? 'pointer' : 'default',
                              }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,152,0,0.12)'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <td style={{ padding: '4px', color: '#aaa' }}>{t.label}</td>
                              <td style={{ padding: '4px', color: t.direction === 'UP' ? '#4CAF50' : '#dc3545', fontWeight: 600 }}>
                                {t.direction === 'UP' ? 'L' : 'S'}
                              </td>
                              <td style={{ padding: '4px', textAlign: 'right' }}>{t.entry_price?.toFixed(1)}</td>
                              <td style={{ padding: '4px', textAlign: 'right', color: '#dc3545' }}>{t.sl_price?.toFixed(1)}</td>
                              <td style={{ padding: '4px', textAlign: 'right', color: '#4CAF50' }}>{t.tp_price?.toFixed(1)}</td>
                              <td style={{ padding: '4px', textAlign: 'center', color: resultColor, fontWeight: 600 }}>
                                {t.trade_result}
                              </td>
                              <td style={{ padding: '4px', textAlign: 'right',
                                color: (t.trade_pnl_r || 0) >= 0 ? '#4CAF50' : '#dc3545' }}>
                                {t.trade_pnl_r?.toFixed(2)}R
                              </td>
                              <td style={{ padding: '4px', textAlign: 'center', color: '#888', fontSize: '10px' }}>
                                {dateStr}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ====================== INCREMENTAL DETECTION PANEL ====================== */}
            {(incRunning || incPhase === 'stopped' || incPhase === 'done' || incZones.length > 0) && (
              <div style={{
                ...sectionStyle,
                border: '1px solid rgba(123,31,162,0.4)',
                backgroundColor: 'rgba(123,31,162,0.08)',
              }}>
                {/* Header con controles */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', color: '#CE93D8' }}>
                    Deteccion Incremental
                    {incZones.length > 0 && (
                      <span style={{ fontSize: '11px', color: '#FF9800', marginLeft: '8px', fontWeight: 400 }}>
                        {incZones.length} zonas
                      </span>
                    )}
                  </h4>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {/* Minimizar */}
                    {(incRunning || incPhase === 'stopped') && (
                      <button onClick={() => { setIncMinimized(true); onClose(); }}
                        style={{ padding: '3px 8px', backgroundColor: 'rgba(255,255,255,0.1)', color: '#aaa',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                        title="Minimizar - ver barra flotante">
                        _
                      </button>
                    )}
                    {/* Pause/Resume */}
                    {incRunning && !incPaused && (
                      <button onClick={handleIncPause}
                        style={{ padding: '3px 10px', backgroundColor: '#FF9800', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                        Pausar
                      </button>
                    )}
                    {incRunning && incPaused && (
                      <button onClick={handleIncPause}
                        style={{ padding: '3px 10px', backgroundColor: '#4CAF50', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                        Reanudar
                      </button>
                    )}
                    {/* Stop */}
                    {incRunning && (
                      <button onClick={handleIncStop}
                        style={{ padding: '3px 10px', backgroundColor: '#dc3545', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                        Detener
                      </button>
                    )}
                    {/* Resume (despues de stop) */}
                    {!incRunning && incPhase === 'stopped' && (
                      <button onClick={handleIncResume}
                        style={{ padding: '3px 10px', backgroundColor: '#4CAF50', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                        Retomar
                      </button>
                    )}
                    {/* Limpiar */}
                    {!incRunning && (incPhase === 'done' || incPhase === 'stopped') && (
                      <button onClick={() => { setIncZones([]); setIncStatus(null); setIncPhase(''); incZoneCountRef.current = 0; }}
                        style={{ padding: '3px 10px', backgroundColor: 'rgba(255,255,255,0.1)', color: '#aaa',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {/* Progreso */}
                {incStatus && (incRunning || incPhase === 'stopped' || incPhase === 'done') && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                      <span style={{ color: '#e0e0e0' }}>
                        {incPhase === 'fetching' && 'Descargando datos historicos...'}
                        {incPhase === 'detecting' && `Chunk ${incStatus.current_chunk || 0} / ${incStatus.total_chunks || 0}`}
                        {incPhase === 'paused' && `Pausado - Chunk ${incStatus.current_chunk || 0} / ${incStatus.total_chunks || 0}`}
                        {incPhase === 'stopped' && `Detenido - ${incStatus.chunks_completed || 0} / ${incStatus.total_chunks || 0} chunks`}
                        {incPhase === 'done' && `Completado - ${incStatus.total_chunks || 0} chunks`}
                      </span>
                      <span style={{ color: incPhase === 'done' ? '#4CAF50' : '#CE93D8' }}>
                        {incStatus.total_chunks > 0
                          ? `${Math.round((incStatus.chunks_completed || 0) / incStatus.total_chunks * 100)}%`
                          : ''}
                      </span>
                    </div>
                    {/* Barra */}
                    {incPhase === 'fetching' ? (
                      <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.1)',
                        borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          width: '40%', height: '100%',
                          background: 'linear-gradient(90deg, transparent, #7B1FA2, #CE93D8, transparent)',
                          borderRadius: '3px', position: 'absolute',
                          animation: 'vpBtIndeterminate 1.5s ease-in-out infinite',
                        }} />
                      </div>
                    ) : incStatus.total_chunks > 0 && (
                      <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.1)',
                        borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.round((incStatus.chunks_completed || 0) / incStatus.total_chunks * 100)}%`,
                          height: '100%',
                          background: incPhase === 'done' ? '#4CAF50'
                            : incPhase === 'stopped' ? '#FF9800'
                            : 'linear-gradient(90deg, #7B1FA2, #CE93D8)',
                          borderRadius: '3px', transition: 'width 0.5s ease',
                        }} />
                      </div>
                    )}
                    {/* Tiempos */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginTop: '4px', color: '#888' }}>
                      <span>Transcurrido: {formatTime(incStatus.elapsed || 0)}</span>
                      {incStatus.estimated_remaining > 0 && incRunning && (
                        <span>~{formatTime(incStatus.estimated_remaining)} restante</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Tabla de zonas parciales (sin stats agregados) */}
                {incExpandedTrades.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#888' }}>
                        Trades individuales ({incExpandedTrades.length})
                        {incPhase !== 'done' && <span style={{ color: '#FF9800' }}> - parcial</span>}
                      </span>
                    </div>
                    <div style={{ maxHeight: '250px', overflow: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                            <th style={{ padding: '3px', textAlign: 'left', color: '#888' }}>#</th>
                            <th style={{ padding: '3px', textAlign: 'left', color: '#888' }}>Dir</th>
                            <th style={{ padding: '3px', textAlign: 'right', color: '#888' }}>Entry</th>
                            <th style={{ padding: '3px', textAlign: 'center', color: '#888' }}>Result</th>
                            <th style={{ padding: '3px', textAlign: 'right', color: '#888' }}>PnL R</th>
                            <th style={{ padding: '3px', textAlign: 'center', color: '#888' }}>Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {incExpandedTrades.map((t, i) => {
                            const resultColor = t.trade_result === 'WIN' ? '#4CAF50'
                              : t.trade_result === 'LOSS' ? '#dc3545'
                              : t.trade_result === 'OPEN' ? '#FFA500' : '#888';
                            const dateStr = t.entry_timestamp
                              ? new Date(t.entry_timestamp).toLocaleDateString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                              : '';
                            return (
                              <tr key={i}
                                onClick={() => t.entry_timestamp && handleNavigateToTrade(t.entry_timestamp)}
                                style={{
                                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                                  cursor: t.entry_timestamp ? 'pointer' : 'default',
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(123,31,162,0.15)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <td style={{ padding: '3px', color: '#aaa' }}>{t.label}</td>
                                <td style={{ padding: '3px', color: t.direction === 'UP' ? '#4CAF50' : '#dc3545', fontWeight: 600 }}>
                                  {t.direction === 'UP' ? 'L' : 'S'}
                                </td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>{t.entry_price?.toFixed(1)}</td>
                                <td style={{ padding: '3px', textAlign: 'center', color: resultColor, fontWeight: 600 }}>
                                  {t.trade_result}
                                </td>
                                <td style={{ padding: '3px', textAlign: 'right',
                                  color: (t.trade_pnl_r || 0) >= 0 ? '#4CAF50' : '#dc3545' }}>
                                  {t.trade_pnl_r?.toFixed(2)}R
                                </td>
                                <td style={{ padding: '3px', textAlign: 'center', color: '#888', fontSize: '10px' }}>
                                  {dateStr}
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
          </div>
        )}

        {/* ====================== REALTIME TAB ====================== */}
        {activeTab === 'realtime' && (
          <div>
            {/* Status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '12px', height: '12px', borderRadius: '50%',
                backgroundColor: rtRunning ? '#4CAF50' : '#dc3545',
                boxShadow: rtRunning ? '0 0 8px rgba(76,175,80,0.5)' : 'none',
              }} />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                {rtRunning ? 'Servicio VP activo' : 'Servicio VP detenido'}
              </span>
              <button onClick={handleRtToggle} disabled={rtLoading} style={{
                ...(rtRunning ? btnDanger : btnPrimary),
                padding: '6px 14px', fontSize: '12px', marginLeft: 'auto',
                opacity: rtLoading ? 0.6 : 1,
              }}>
                {rtLoading ? '...' : rtRunning ? 'Detener' : 'Iniciar'}
              </button>
            </div>

            {/* Config msg */}
            {rtMsg && (
              <div style={{
                padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px',
                backgroundColor: rtMsg.type === 'ok' ? 'rgba(76,175,80,0.2)' : 'rgba(220,53,69,0.2)',
                color: rtMsg.type === 'ok' ? '#4CAF50' : '#ff6b6b',
              }}>
                {rtMsg.text}
              </div>
            )}

            {/* Realtime stats */}
            {rtStatus && rtRunning && (
              <div style={sectionStyle}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Estadisticas</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px' }}>
                  <div><span style={{ color: '#888' }}>Zonas:</span> <strong>{rtStatus.stats?.zones_detected || 0}</strong></div>
                  <div><span style={{ color: '#888' }}>Alertas:</span> <strong>{rtStatus.stats?.alerts_sent || 0}</strong></div>
                  <div><span style={{ color: '#888' }}>Velas:</span> <strong>{rtStatus.stats?.candles_processed || 0}</strong></div>
                </div>
                {rtStatus.zones_count && Object.keys(rtStatus.zones_count).length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
                    Zonas por simbolo: {Object.entries(rtStatus.zones_count).map(([s, c]) => `${s}: ${c}`).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* VP config for realtime */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Configuracion VP Realtime</h4>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Los parametros de la pestana Backtest se aplican tambien al servicio realtime
              </div>

              <div style={labelStyle}>
                <span>Warmup Candles (historico inicial)</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.warmup_candles}</span>
              </div>
              <input type="range" min={20} max={200} step={10} value={params.warmup_candles}
                onChange={e => handleParamChange('warmup_candles', e.target.value)} style={sliderStyle} />

              <button onClick={handleRtConfigSave} disabled={rtLoading} style={{
                ...btnPrimary, width: '100%', marginTop: '12px', opacity: rtLoading ? 0.6 : 1,
              }}>
                {rtLoading ? 'Guardando...' : 'Guardar Config y Re-analizar'}
              </button>
            </div>
          </div>
        )}

        {/* ====================== OPTIMIZER TAB ====================== */}
        {activeTab === 'optimizer' && (
          <div>
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Seleccionar Parametros a Optimizar</h4>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Los parametros no seleccionados usaran los valores del tab Backtest
              </div>

              {optimizableParams.map(p => (
                <div key={p.key} style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <input type="checkbox" checked={!!optParamRanges[p.key]}
                      onChange={() => toggleOptParam(p.key)} />
                    <span style={{ minWidth: '140px' }}>{p.label}</span>
                    {optParamRanges[p.key] && (
                      <span style={{ color: '#888', fontSize: '11px' }}>
                        [{optParamRanges[p.key].min} - {optParamRanges[p.key].max}] step {optParamRanges[p.key].step}
                      </span>
                    )}
                  </label>
                  {optParamRanges[p.key] && (
                    <div style={{ display: 'flex', gap: '8px', marginLeft: '24px', marginTop: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#888' }}>Min:
                        <input type="number" step={p.step} value={optParamRanges[p.key].min}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], min: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Max:
                        <input type="number" step={p.step} value={optParamRanges[p.key].max}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], max: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Step:
                        <input type="number" step={p.step} value={optParamRanges[p.key].step}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], step: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Metric + combos info */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Metrica objetivo</div>
                  <select value={optMetric} onChange={e => setOptMetric(e.target.value)}
                    style={{ padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                    <option value="expectancy">Expectancy</option>
                    <option value="total_pnl_r">Total PnL (R)</option>
                    <option value="win_rate">Win Rate</option>
                    <option value="profit_factor">Profit Factor</option>
                    {params.detection_mode === 'progressive' && (
                      <option value="avg_progressive_quality">Prog. Quality (D engordada)</option>
                    )}
                    {params.detection_mode === 'progressive' && (
                      <option value="zones_x_quality">Zones x Quality</option>
                    )}
                  </select>
                </div>
                <div style={{ fontSize: '12px', color: totalOptCombos > 5000 ? '#dc3545' : '#aaa' }}>
                  {totalOptCombos > 0 ? `${totalOptCombos.toLocaleString()} combinaciones` : 'Selecciona parametros'}
                  {totalOptCombos > 5000 && ' (max 5000)'}
                </div>
              </div>

              {/* Estimate result */}
              {optEstimate && (
                <div style={{
                  marginTop: '12px', padding: '8px 12px', borderRadius: '6px',
                  backgroundColor: optEstimate.estimated_seconds < 60 ? 'rgba(76,175,80,0.15)' :
                    optEstimate.estimated_seconds < 300 ? 'rgba(255,193,7,0.15)' : 'rgba(220,53,69,0.15)',
                  fontSize: '12px',
                }}>
                  <div>Tiempo estimado: <strong>{optEstimate.estimated_seconds < 60 ?
                    `${optEstimate.estimated_seconds.toFixed(0)}s` :
                    `${(optEstimate.estimated_seconds / 60).toFixed(1)} min`}</strong></div>
                  <div style={{ color: '#888', marginTop: '2px' }}>
                    {optEstimate.candles?.toLocaleString()} velas | {optEstimate.total_combos} combos | ~{(optEstimate.avg_per_combo * 1000).toFixed(0)}ms/combo
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                {!optEstimate ? (
                  <button onClick={handleOptEstimate} disabled={optLoading || totalOptCombos === 0 || totalOptCombos > 5000}
                    style={{ ...btnPrimary, flex: 1, opacity: (optLoading || totalOptCombos === 0 || totalOptCombos > 5000) ? 0.5 : 1 }}>
                    {optPhase === 'estimating' ? 'Estimando...' : 'Estimar y Ejecutar'}
                  </button>
                ) : (
                  <>
                    <button onClick={handleOptRun} disabled={optLoading}
                      style={{ ...btnPrimary, flex: 1, opacity: optLoading ? 0.5 : 1 }}>
                      {optPhase === 'running' ? 'Ejecutando...' : 'Confirmar y Ejecutar'}
                    </button>
                    <button onClick={() => setOptEstimate(null)} style={btnSecondary}>Cancelar</button>
                  </>
                )}
              </div>

              {/* Barra de progreso de estimacion */}
              {optPhase === 'estimating' && optProgress && optProgress.phase === 'estimating' && optProgress.est_total > 0 && (
                <div style={{
                  marginTop: '12px', padding: '12px', borderRadius: '8px',
                  backgroundColor: 'rgba(255, 152, 0, 0.1)',
                  border: '1px solid rgba(255, 152, 0, 0.3)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                    <span style={{ color: '#e0e0e0' }}>
                      Estimando: sample {optProgress.est_current} / {optProgress.est_total}
                    </span>
                    <span style={{ color: '#FF9800' }}>
                      {Math.round(optProgress.est_current / optProgress.est_total * 100)}%
                    </span>
                  </div>
                  <div style={{
                    width: '100%', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '5px', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.round(optProgress.est_current / optProgress.est_total * 100)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #FF9800, #FFC107)',
                      borderRadius: '5px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: '#888' }}>
                    <span>Transcurrido: {formatTime(optProgress.est_elapsed)}</span>
                    {optProgress.estimated_remaining > 0 && (
                      <span>~{formatTime(optProgress.estimated_remaining)} restante</span>
                    )}
                  </div>
                </div>
              )}

              {/* Barra de progreso de optimizacion */}
              {optPhase === 'running' && optProgress && optProgress.total > 0 && (
                <div style={{
                  marginTop: '12px', padding: '12px', borderRadius: '8px',
                  backgroundColor: 'rgba(0, 86, 210, 0.1)',
                  border: '1px solid rgba(0, 86, 210, 0.3)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                    <span style={{ color: '#e0e0e0' }}>
                      {optProgress.current} / {optProgress.total} combos
                    </span>
                    <span style={{ color: '#4CAF50' }}>
                      {Math.round(optProgress.current / optProgress.total * 100)}%
                    </span>
                  </div>
                  {/* Barra */}
                  <div style={{
                    width: '100%', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '5px', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.round(optProgress.current / optProgress.total * 100)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #0056D2, #4CAF50)',
                      borderRadius: '5px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: '#888' }}>
                    <span>Transcurrido: {formatTime(optProgress.elapsed)}</span>
                    <span>~{formatTime(optProgress.estimated_remaining)} restante</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '2px', color: '#888' }}>
                    <span>{optProgress.avg_per_combo?.toFixed(1)}s/combo</span>
                    {optProgress.best_so_far && (
                      <span style={{ color: '#FF9800' }}>
                        Mejor: {optProgress.metric}={optProgress.best_so_far.value} | WR={optProgress.best_so_far.win_rate}% | {optProgress.best_so_far.total_zones} zonas
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Opt Results table */}
            {optResults && optResults.results && optResults.results.length > 0 && (
              <div style={{ ...sectionStyle, overflow: 'auto' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>
                  Top {optResults.results.length} Resultados ({optResults.elapsed}s, {optResults.total_combos} combos)
                </h4>
                <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>#</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>Zones</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>WR%</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>W/L</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>PnL R</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>Expect</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>PF</th>
                      {params.detection_mode === 'progressive' && (
                        <th style={{ padding: '4px', textAlign: 'right', color: '#FF9800' }}>PQ</th>
                      )}
                      {params.detection_mode === 'progressive' && (
                        <th style={{ padding: '4px', textAlign: 'right', color: '#CE93D8' }}>Z×Q</th>
                      )}
                      <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>Params</th>
                      <th style={{ padding: '4px', color: '#888' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {optResults.results.map((r, i) => (
                      <tr key={i} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: i === 0 ? 'rgba(0,86,210,0.1)' : 'transparent',
                      }}>
                        <td style={{ padding: '4px', color: i === 0 ? '#0056D2' : '#aaa' }}>{i + 1}</td>
                        <td style={{ padding: '4px', textAlign: 'right', color: '#888' }}>{r.total_zones || 0}</td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.win_rate?.toFixed(1)}%</td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.wins}/{r.losses}</td>
                        <td style={{ padding: '4px', textAlign: 'right', color: r.total_pnl_r >= 0 ? '#4CAF50' : '#dc3545' }}>
                          {r.total_pnl_r?.toFixed(1)}
                        </td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.expectancy?.toFixed(3)}</td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.profit_factor?.toFixed(2)}</td>
                        {params.detection_mode === 'progressive' && (
                          <td style={{ padding: '4px', textAlign: 'right', color: '#FF9800' }}>
                            {r.avg_progressive_quality?.toFixed(1) || '0'}
                          </td>
                        )}
                        {params.detection_mode === 'progressive' && (
                          <td style={{ padding: '4px', textAlign: 'right', color: '#CE93D8' }}>
                            {r.zones_x_quality?.toFixed(0) || '0'}
                          </td>
                        )}
                        <td style={{ padding: '4px', fontSize: '10px', color: '#888', maxWidth: '180px', overflow: 'hidden' }}>
                          {r.params && Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(', ')}
                        </td>
                        <td style={{ padding: '4px' }}>
                          <button onClick={() => {
                            if (r.params) {
                              setParams(prev => ({ ...prev, ...r.params }));
                              setActiveTab('backtest');
                            }
                          }} style={{
                            padding: '2px 8px', backgroundColor: '#0056D2', color: 'white',
                            border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
                          }}>Aplicar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'strat_optimizer' && (
          <div>
            {/* Explicacion */}
            <div style={{ ...sectionStyle, backgroundColor: 'rgba(0, 150, 136, 0.08)', border: '1px solid rgba(0, 150, 136, 0.25)' }}>
              <div style={{ fontSize: '12px', color: '#80CBC4' }}>
                Las zonas se detectan UNA vez con los parametros actuales del tab Backtest.
                Luego se prueban diferentes configuraciones de trading (estrategia, SL, TP, entrada)
                sobre las mismas zonas para encontrar la mejor forma de operar.
              </div>
            </div>

            {/* Estrategias a probar */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#009688' }}>Estrategias a Comparar</h4>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {['breakout', 'retest', 'mean_reversion'].map(strat => (
                  <button key={strat}
                    onClick={() => toggleSoStrategy(strat)}
                    style={{
                      padding: '6px 14px', fontSize: '12px', cursor: 'pointer',
                      border: soStrategies.includes(strat) ? '1px solid #009688' : '1px solid #555',
                      borderRadius: '4px',
                      background: soStrategies.includes(strat) ? '#009688' : 'transparent',
                      color: soStrategies.includes(strat) ? '#fff' : '#aaa',
                    }}
                  >
                    {strat === 'breakout' ? 'Breakout' : strat === 'retest' ? 'Retest (Pullback)' : 'Mean Reversion'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                {soStrategies.length > 1
                  ? `Se compararan ${soStrategies.length} estrategias en cada combinacion`
                  : 'Selecciona multiples para comparar entre estrategias'}
              </div>
            </div>

            {/* Parametros de trading optimizables */}
            <div style={sectionStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#009688' }}>Parametros de Trading a Optimizar</h4>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Los parametros de deteccion de zonas se toman del tab Backtest (no cambian)
              </div>

              {strategyOptParams.map(p => (
                <div key={p.key} style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <input type="checkbox" checked={!!soParamRanges[p.key]}
                      onChange={() => toggleSoParam(p.key)} />
                    <span style={{ minWidth: '160px' }}>{p.label}</span>
                    {soParamRanges[p.key] && (
                      <span style={{ color: '#888', fontSize: '11px' }}>
                        {p.type === 'enum'
                          ? `[${(soParamRanges[p.key].values || p.values).join(', ')}]`
                          : `[${soParamRanges[p.key].min} - ${soParamRanges[p.key].max}] step ${soParamRanges[p.key].step}`
                        }
                      </span>
                    )}
                  </label>
                  {soParamRanges[p.key] && p.type !== 'enum' && (
                    <div style={{ display: 'flex', gap: '8px', marginLeft: '24px', marginTop: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#888' }}>Min:
                        <input type="number" step={p.step} value={soParamRanges[p.key].min}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setSoParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], min: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Max:
                        <input type="number" step={p.step} value={soParamRanges[p.key].max}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setSoParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], max: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Step:
                        <input type="number" step={p.step} value={soParamRanges[p.key].step}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setSoParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], step: v }
                          })); }}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Metric + combos info */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Metrica objetivo</div>
                  <select value={soMetric} onChange={e => setSoMetric(e.target.value)}
                    style={{ padding: '6px', backgroundColor: '#2a2a4a', color: '#e0e0e0',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                    <option value="expectancy">Expectancy</option>
                    <option value="total_pnl_r">Total PnL (R)</option>
                    <option value="win_rate">Win Rate</option>
                    <option value="profit_factor">Profit Factor</option>
                  </select>
                </div>
                <div style={{ fontSize: '12px', color: totalSoCombos > 10000 ? '#dc3545' : '#aaa' }}>
                  {totalSoCombos > 0 ? `${totalSoCombos.toLocaleString()} combinaciones` : 'Selecciona parametros o multiples estrategias'}
                  {totalSoCombos > 10000 && ' (max 10000)'}
                </div>
              </div>

              {/* Estimate result */}
              {soEstimate && (
                <div style={{
                  marginTop: '12px', padding: '8px 12px', borderRadius: '6px',
                  backgroundColor: soEstimate.estimated_seconds < 60 ? 'rgba(76,175,80,0.15)' :
                    soEstimate.estimated_seconds < 300 ? 'rgba(255,193,7,0.15)' : 'rgba(220,53,69,0.15)',
                  fontSize: '12px',
                }}>
                  <div>Tiempo estimado: <strong>{soEstimate.estimated_seconds < 60 ?
                    `${soEstimate.estimated_seconds.toFixed(0)}s` :
                    `${(soEstimate.estimated_seconds / 60).toFixed(1)} min`}</strong></div>
                  <div style={{ color: '#888', marginTop: '2px' }}>
                    {soEstimate.candles?.toLocaleString()} velas | {soEstimate.zones_detected} zonas fijas | {soEstimate.total_combos} combos
                  </div>
                  <div style={{ color: '#80CBC4', marginTop: '2px', fontSize: '11px' }}>
                    Deteccion: {soEstimate.detect_time}s | ~{(soEstimate.avg_per_combo * 1000).toFixed(0)}ms/combo
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                {!soEstimate ? (
                  <button onClick={handleSoEstimate} disabled={soLoading || totalSoCombos === 0 || totalSoCombos > 10000}
                    style={{ ...btnPrimary, flex: 1, backgroundColor: '#009688',
                      opacity: (soLoading || totalSoCombos === 0 || totalSoCombos > 10000) ? 0.5 : 1 }}>
                    {soPhase === 'estimating' ? 'Estimando...' : 'Estimar y Ejecutar'}
                  </button>
                ) : (
                  <>
                    <button onClick={handleSoRun} disabled={soLoading}
                      style={{ ...btnPrimary, flex: 1, backgroundColor: '#009688', opacity: soLoading ? 0.5 : 1 }}>
                      {soPhase === 'running' ? 'Ejecutando...' : 'Confirmar y Ejecutar'}
                    </button>
                    <button onClick={() => setSoEstimate(null)} style={btnSecondary}>Cancelar</button>
                  </>
                )}
              </div>

              {/* Barra de progreso */}
              {soPhase === 'running' && soProgress && soProgress.total > 0 && (
                <div style={{
                  marginTop: '12px', padding: '12px', borderRadius: '8px',
                  backgroundColor: 'rgba(0, 150, 136, 0.1)',
                  border: '1px solid rgba(0, 150, 136, 0.3)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                    <span style={{ color: '#e0e0e0' }}>
                      {soProgress.current} / {soProgress.total} combos
                    </span>
                    <span style={{ color: '#4CAF50' }}>
                      {Math.round(soProgress.current / soProgress.total * 100)}%
                    </span>
                  </div>
                  <div style={{
                    width: '100%', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '5px', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.round(soProgress.current / soProgress.total * 100)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #009688, #4CAF50)',
                      borderRadius: '5px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: '#888' }}>
                    <span>Transcurrido: {formatTime(soProgress.elapsed)}</span>
                    <span>~{formatTime(soProgress.estimated_remaining)} restante</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '2px', color: '#888' }}>
                    <span>{soProgress.avg_per_combo ? `${(soProgress.avg_per_combo * 1000).toFixed(0)}ms/combo` : ''}</span>
                    {soProgress.best_so_far && (
                      <span style={{ color: '#FF9800' }}>
                        Mejor: {soProgress.metric}={soProgress.best_so_far.value} | WR={soProgress.best_so_far.win_rate}%
                        {soProgress.best_so_far.entry_strategy ? ` | ${soProgress.best_so_far.entry_strategy}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Results table */}
            {soResults && soResults.results && soResults.results.length > 0 && (
              <div style={{ ...sectionStyle, overflow: 'auto' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#009688' }}>
                  Top {soResults.results.length} ({soResults.elapsed}s, {soResults.total_combos} combos, {soResults.zones_detected} zonas fijas)
                </h4>
                <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>#</th>
                      <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>Strategy</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>WR%</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>W/L</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>PnL R</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>Expect</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>PF</th>
                      <th style={{ padding: '4px', textAlign: 'right', color: '#888' }}>MaxDD</th>
                      <th style={{ padding: '4px', textAlign: 'left', color: '#888' }}>Params</th>
                      <th style={{ padding: '4px', color: '#888' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {soResults.results.map((r, i) => (
                      <tr key={i} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: i === 0 ? 'rgba(0, 150, 136, 0.1)' : 'transparent',
                      }}>
                        <td style={{ padding: '4px', color: i === 0 ? '#009688' : '#aaa' }}>{i + 1}</td>
                        <td style={{ padding: '4px', color: '#80CBC4', fontSize: '10px' }}>
                          {r.entry_strategy || r.params?.entry_strategy || '-'}
                        </td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.win_rate?.toFixed(1)}%</td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.wins}/{r.losses}</td>
                        <td style={{ padding: '4px', textAlign: 'right', color: r.total_pnl_r >= 0 ? '#4CAF50' : '#dc3545' }}>
                          {r.total_pnl_r?.toFixed(1)}
                        </td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.expectancy?.toFixed(3)}</td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{r.profit_factor?.toFixed(2)}</td>
                        <td style={{ padding: '4px', textAlign: 'right', color: r.max_drawdown_r > 0 ? '#FF9800' : '#888' }}>
                          {r.max_drawdown_r?.toFixed(1)}
                        </td>
                        <td style={{ padding: '4px', fontSize: '10px', color: '#888', maxWidth: '200px', overflow: 'hidden' }}>
                          {r.params && Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(', ')}
                        </td>
                        <td style={{ padding: '4px' }}>
                          <button onClick={() => {
                            if (r.params) {
                              setParams(prev => ({ ...prev, ...r.params }));
                              setActiveTab('backtest');
                            }
                          }} style={{
                            padding: '2px 8px', backgroundColor: '#009688', color: 'white',
                            border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
                          }}>Aplicar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default VPZoneScannerSettings;
