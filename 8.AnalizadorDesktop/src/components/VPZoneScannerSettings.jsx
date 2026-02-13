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
  prog_thickness_metric: "kurtosis",
};

const MAX_DAYS_BY_INTERVAL = {
  "1": 7, "3": 21, "5": 400, "15": 730, "30": 730,
  "60": 1095, "120": 1095, "240": 1095, "D": 2000, "W": 1000
};

const DEFAULT_ZONE_DAYS = {
  "1": 3, "3": 7, "5": 60, "15": 90, "30": 120,
  "60": 180, "120": 180, "240": 365, "D": 730, "W": 730
};

const STRING_PARAMS = ['sl_mode', 'entry_mode', 'position_mode', 'detection_mode', 'prog_stop_mode', 'prog_thickness_metric'];
const BOOL_PARAMS = ['include_pb_shapes'];

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


function VPZoneScannerSettings({ isOpen, onClose, indicatorManager, symbol, interval, onRealtimeChange }) {
  const maxDays = useMemo(() => MAX_DAYS_BY_INTERVAL[String(interval)] || 400, [interval]);
  const defaultDays = useMemo(() => DEFAULT_ZONE_DAYS[String(interval)] || 60, [interval]);

  const [params, setParams] = useState(defaultParams);
  const [zoneDays, setZoneDays] = useState(defaultDays);
  const [activeTab, setActiveTab] = useState('backtest'); // 'backtest' | 'realtime' | 'optimizer'
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
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

  // Presets
  const [presets, setPresets] = useState({}); // { "nombre": { params, zoneDays, savedAt } }
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetMsg, setPresetMsg] = useState(null);

  const getManager = useCallback(() => {
    return indicatorManager || IndicatorManagerRegistry.get(symbol);
  }, [indicatorManager, symbol]);

  // ---- Param change handler ----
  const handleParamChange = useCallback((key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: BOOL_PARAMS.includes(key)
        ? Boolean(value)
        : STRING_PARAMS.includes(key) ? value : Number(value)
    }));
  }, []);

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

  // Polling de progreso de optimizacion
  useEffect(() => {
    if (optPhase !== 'running') {
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
        if (data.running) {
          setOptProgress(data);
        } else if (data.current > 0 && data.current >= data.total) {
          setOptProgress(data); // Ultimo update
        }
      } catch (e) { /* silencio */ }
    };
    poll(); // Inmediato
    optProgressRef.current = setInterval(poll, 3000);
    return () => {
      if (optProgressRef.current) {
        clearInterval(optProgressRef.current);
        optProgressRef.current = null;
      }
    };
  }, [optPhase]);

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
            'breakout_confirm_bars', 'position_mode', 'warmup_candles'];
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
  const handleBacktest = useCallback(async () => {
    setLoading(true);
    setStats(null);
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
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
    ];
    const sharedParams = [
      { key: 'bins', label: 'Bins', min: 20, max: 100, step: 10 },
      { key: 'va_percent', label: 'VA %', min: 0.50, max: 0.90, step: 0.05 },
      { key: 'min_d_score', label: 'Min D-Score', min: 20, max: 80, step: 5 },
      { key: 'lookforward_bars', label: 'Lookforward Bars', min: 50, max: 300, step: 25 },
      { key: 'tp_rr_ratio', label: 'TP R:R', min: 1.0, max: 4.0, step: 0.5 },
      { key: 'breakout_confirm_bars', label: 'Breakout Confirm', min: 0, max: 5, step: 1 },
    ];
    const modeParams = params.detection_mode === 'progressive' ? progParams : fixedParams;
    return [...modeParams, ...sharedParams];
  }, [params.detection_mode]);

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
      let count = 0;
      let v = r.min;
      while (v <= r.max + r.step * 0.001) { count++; v += r.step; }
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

  // Helper: formato de tiempo legible
  const formatTime = (seconds) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // ---- Render ----
  if (!isOpen) return null;

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
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer',
          }}>x</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {tabBtn('backtest', 'Backtest')}
          {tabBtn('realtime', 'Tiempo Real')}
          {tabBtn('optimizer', 'Optimizador')}
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

              <div style={labelStyle}>
                <span>Breakout Confirm Bars</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.breakout_confirm_bars}{params.breakout_confirm_bars === 0 ? ' (close breakout)' : ''}</span>
              </div>
              <input type="range" min={0} max={5} step={1} value={params.breakout_confirm_bars}
                onChange={e => handleParamChange('breakout_confirm_bars', e.target.value)} style={sliderStyle} />

              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
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
                <div style={{ flex: 1 }} />
              </div>

              <div style={labelStyle}>
                <span>Max Price Range %</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{params.max_range_pct}%</span>
              </div>
              <input type="range" min={0.1} max={10} step={0.1} value={params.max_range_pct}
                onChange={e => handleParamChange('max_range_pct', e.target.value)} style={sliderStyle} />
            </div>

            {/* Days + Run */}
            <div style={sectionStyle}>
              <div style={labelStyle}>
                <span>Dias de historico</span>
                <span style={{ color: '#0056D2', fontWeight: 600 }}>{zoneDays} dias (max {maxDays})</span>
              </div>
              <input type="range" min={1} max={maxDays} step={1} value={zoneDays}
                onChange={e => setZoneDays(Number(e.target.value))} style={sliderStyle} />

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button onClick={handleBacktest} disabled={loading} style={{
                  ...btnPrimary, opacity: loading ? 0.6 : 1, flex: 1
                }}>
                  {loading ? 'Analizando...' : 'Detectar Zonas VP'}
                </button>
                <button onClick={() => { setParams(defaultParams); setZoneDays(defaultDays); }} style={btnSecondary}>
                  Reset
                </button>
              </div>
            </div>

            {/* Stats result */}
            {stats && (
              <div style={{ ...sectionStyle, backgroundColor: 'rgba(0,86,210,0.1)' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0056D2' }}>Resultados</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '12px' }}>
                  <div><span style={{ color: '#888' }}>Zonas:</span> <strong>{stats.total_zones}</strong></div>
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
                          onChange={e => setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], min: Number(e.target.value) }
                          }))}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Max:
                        <input type="number" step={p.step} value={optParamRanges[p.key].max}
                          onChange={e => setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], max: Number(e.target.value) }
                          }))}
                          style={{ width: '60px', marginLeft: '4px', padding: '3px', backgroundColor: '#2a2a4a',
                            color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', fontSize: '11px' }} />
                      </label>
                      <label style={{ fontSize: '11px', color: '#888' }}>Step:
                        <input type="number" step={p.step} value={optParamRanges[p.key].step}
                          onChange={e => setOptParamRanges(prev => ({
                            ...prev, [p.key]: { ...prev[p.key], step: Number(e.target.value) }
                          }))}
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
      </div>
    </div>
  );
}

export default VPZoneScannerSettings;
