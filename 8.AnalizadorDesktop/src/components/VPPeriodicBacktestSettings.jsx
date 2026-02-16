// VPPeriodicBacktestSettings.jsx
// Panel para ejecutar backtest de estrategias VP Periodic + VWAP
// y visualizar resultados en el chart via ZoneVisualizerIndicator

import React, { useState, useCallback, useEffect, useRef } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';
import { API_BASE_URL } from '../config';

const MAX_DAYS_BY_INTERVAL = {
  "1": 400, "3": 400, "5": 400, "15": 180, "30": 360,
  "60": 730, "120": 730, "240": 1095, "D": 2000, "W": 1000
};

const DEFAULT_DAYS = {
  "1": 30, "5": 90, "15": 90, "60": 180, "240": 365, "D": 730, "W": 730
};

const VWAP_FILTER_OPTIONS = {
  none:    { label: 'Sin filtro',   desc: 'No usa VWAP como filtro de entrada' },
  vwap:    { label: 'VWAP',        desc: 'LONG: price > VWAP, SHORT: price < VWAP' },
  upper_1: { label: '\u00B11 Sigma', desc: 'LONG: price > +1\u03C3, SHORT: price < -1\u03C3' },
  upper_2: { label: '\u00B12 Sigma', desc: 'LONG: price > +2\u03C3, SHORT: price < -2\u03C3' },
};

// Para Rejection Confluence, tiene opcion adicional 'band_zone'
const VWAP_FILTER_OPTIONS_REJECTION = {
  none:      { label: 'Sin filtro',    desc: 'No usa VWAP como filtro' },
  band_zone: { label: 'Zona 1\u03C3-2\u03C3', desc: 'Precio entre banda 1\u03C3 y 2\u03C3 (original)' },
  vwap:      { label: 'VWAP',          desc: 'LONG: price > VWAP, SHORT: price < VWAP' },
  upper_1:   { label: '\u00B11 Sigma',   desc: 'LONG: price > +1\u03C3, SHORT: price < -1\u03C3' },
  upper_2:   { label: '\u00B12 Sigma',   desc: 'LONG: price > +2\u03C3, SHORT: price < -2\u03C3' },
};

const DIRECTION_FILTER_OPTIONS = {
  both:  { label: 'Both',  desc: 'Long y Short habilitados' },
  long:  { label: 'Long',  desc: 'Solo operaciones Long' },
  short: { label: 'Short', desc: 'Solo operaciones Short' },
};

const STRATEGIES = {
  poc_bounce: {
    name: "POC Bounce",
    description: "Mean reversion al POC. Cruza POC filtrado por VWAP. SL en borde VA, TP configurable.",
    defaults: { vp_period: 240, tp_rr: 2.0, bins: 50, vwap_filter: 'vwap' },
    vwapFilterOptions: VWAP_FILTER_OPTIONS,
    params: [
      { key: 'vp_period', label: 'VP Period (velas)', min: 60, max: 1440, step: 60 },
      { key: 'tp_rr', label: 'TP (R:R)', min: 0.5, max: 5.0, step: 0.5 },
      { key: 'bins', label: 'VP Bins', min: 20, max: 100, step: 10 },
    ],
  },
  va_breakout: {
    name: "VA Breakout",
    description: "Breakout del Value Area. N cierres fuera del VA + filtro VWAP. SL en POC.",
    defaults: { vp_period: 480, tp_rr: 3.0, confirm_bars: 2, min_va_width_pct: 0.3, bins: 50, vwap_filter: 'upper_1' },
    vwapFilterOptions: VWAP_FILTER_OPTIONS,
    params: [
      { key: 'vp_period', label: 'VP Period (velas)', min: 60, max: 1440, step: 60 },
      { key: 'tp_rr', label: 'TP (R:R)', min: 1.0, max: 5.0, step: 0.5 },
      { key: 'confirm_bars', label: 'Confirm Bars', min: 1, max: 5, step: 1 },
      { key: 'min_va_width_pct', label: 'Min VA Width %', min: 0.1, max: 2.0, step: 0.1 },
      { key: 'bins', label: 'VP Bins', min: 20, max: 100, step: 10 },
    ],
  },
  rejection_confluence: {
    name: "Rejection Confluence",
    description: "Rechazo en VAH/VAL + confluencia VWAP + vela de rechazo. TP en POC.",
    defaults: { vp_period: 240, tolerance_pct: 0.1, wick_ratio: 0.6, bins: 50, vwap_filter: 'band_zone' },
    vwapFilterOptions: VWAP_FILTER_OPTIONS_REJECTION,
    params: [
      { key: 'vp_period', label: 'VP Period (velas)', min: 60, max: 1440, step: 60 },
      { key: 'tolerance_pct', label: 'Tolerance %', min: 0.05, max: 0.5, step: 0.05 },
      { key: 'wick_ratio', label: 'Wick Ratio', min: 0.3, max: 0.9, step: 0.1 },
      { key: 'bins', label: 'VP Bins', min: 20, max: 100, step: 10 },
    ],
  },
  vwap_swing: {
    name: "VWAP Swing",
    description: "VWAP en tendencia + precio bajo/sobre POC (retroceso) + Swing Low/High confirmado. SL en swing, TP por R:R.",
    defaults: { vp_period: 240, tp_rr: 2.0, swing_bars: 3, vwap_lookback: 10, bins: 50, direction_filter: 'both' },
    directionFilterOptions: DIRECTION_FILTER_OPTIONS,
    params: [
      { key: 'vp_period', label: 'VP Period (velas)', min: 60, max: 1440, step: 60 },
      { key: 'tp_rr', label: 'TP (R:R)', min: 1.0, max: 5.0, step: 0.5 },
      { key: 'swing_bars', label: 'Swing Bars (confirmacion)', min: 2, max: 10, step: 1 },
      { key: 'vwap_lookback', label: 'VWAP Lookback (tendencia)', min: 5, max: 50, step: 5 },
      { key: 'bins', label: 'VP Bins', min: 20, max: 100, step: 10 },
    ],
  },
};

const VPPeriodicBacktestSettings = ({ isOpen, onClose, symbol, interval, indicatorManager }) => {
  const [strategy, setStrategy] = useState('poc_bounce');
  const [days, setDays] = useState(() => DEFAULT_DAYS[interval] || 90);
  const [params, setParams] = useState(() => ({ ...STRATEGIES.poc_bounce.defaults }));
  const [vwapPeriod, setVwapPeriod] = useState(20); // Rolling VWAP period
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [showTradeList, setShowTradeList] = useState(false);

  // Actualizar days cuando cambia el interval
  useEffect(() => {
    const def = DEFAULT_DAYS[interval] || 90;
    setDays(def);
  }, [interval]);

  // Reset params cuando cambia estrategia
  const handleStrategyChange = useCallback((newStrategy) => {
    setStrategy(newStrategy);
    setParams({ ...STRATEGIES[newStrategy].defaults });
    setResult(null);
    setError(null);
  }, []);

  const handleParamChange = useCallback((key, value) => {
    // Campos string, no numero
    if (key === 'vwap_filter' || key === 'direction_filter') {
      setParams(prev => ({ ...prev, [key]: value }));
    } else {
      setParams(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
    }
  }, []);

  const getManager = useCallback(() => {
    if (indicatorManager) return indicatorManager;
    return IndicatorManagerRegistry.get(symbol);
  }, [indicatorManager, symbol]);

  const handleRunBacktest = useCallback(async () => {
    const manager = getManager();
    if (!manager) {
      setError('IndicatorManager no disponible. El grafico debe estar cargado.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ phase: 'connecting', percent: 0, message: 'Conectando con backend...' });

    try {
      const res = await manager.runVPPeriodicBacktest({
        days,
        strategy,
        ...params,
        vwap_period: vwapPeriod,
        _onProgress: (p) => setProgress(p),
      });

      if (res.success) {
        setResult(res);
        setProgress(null);
      } else {
        setError(res.error || 'Error desconocido');
        setProgress(null);
      }
    } catch (err) {
      setError(err.message || 'Error ejecutando backtest');
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [getManager, days, strategy, params]);

  const handleClearZones = useCallback(() => {
    const manager = getManager();
    if (manager && manager.zoneVisualizerIndicator) {
      manager.zoneVisualizerIndicator.setVPZones([]);
      if (manager.requestRedraw) manager.requestRedraw();
    }
    setResult(null);
    setShowTradeList(false);
  }, [getManager]);

  const handleTradeClick = useCallback((zone) => {
    const ts = zone.entry_timestamp || zone.start_timestamp;
    if (!ts) return;
    const manager = getManager();
    if (manager && manager.navigateToTimestamp) {
      manager.navigateToTimestamp(ts);
    }
  }, [getManager]);

  if (!isOpen) return null;

  const strategyInfo = STRATEGIES[strategy];
  const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 400;
  const stats = result?.stats;
  const zones = result?.zones || [];

  // Calcular PnL acumulado para la lista de trades
  const tradesWithCumulative = zones.filter(z => z.trade_result && z.trade_result !== 'NO_ENTRY' && z.trade_result !== 'SKIPPED').map((z, idx, arr) => {
    let cumPnl = 0;
    for (let i = 0; i <= idx; i++) {
      cumPnl += (arr[i].trade_pnl_r || 0);
    }
    return { ...z, cumPnl: Math.round(cumPnl * 100) / 100 };
  });

  // --- Modal minimizado: barra flotante compacta ---
  if (minimized) {
    return (
      <div
        style={{
          position: 'fixed', bottom: '16px', right: '16px', zIndex: 10000,
          background: '#12122A', border: '1px solid #333', borderRadius: '8px',
          padding: '8px 14px', color: '#E0E0E0', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          minWidth: '280px',
        }}
        onClick={() => setMinimized(false)}
      >
        <span style={{ fontSize: '13px', color: '#4FC3F7', fontWeight: 'bold' }}>VP Backtest</span>
        {stats ? (
          <span style={{ fontSize: '11px', color: '#CCC' }}>
            {stats.closed} trades | WR {stats.win_rate}% |{' '}
            <span style={{ color: stats.total_pnl_r >= 0 ? '#4CAF50' : '#FF5252', fontWeight: 'bold' }}>
              {stats.total_pnl_r > 0 ? '+' : ''}{stats.total_pnl_r}R
            </span>
          </span>
        ) : loading ? (
          <span style={{ fontSize: '11px', color: '#FFD54F' }}>Ejecutando...</span>
        ) : (
          <span style={{ fontSize: '11px', color: '#888' }}>{symbol} @ {interval}min</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '16px', color: '#888' }} title="Expandir">+</span>
      </div>
    );
  }

  // --- Modal completo ---
  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '40px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1A1A2E', border: '1px solid #333',
          borderRadius: '8px', padding: '0',
          width: showTradeList ? '780px' : '520px',
          maxHeight: '90vh', overflow: 'auto', color: '#E0E0E0',
          transition: 'width 0.2s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderBottom: '1px solid #333',
          background: '#12122A',
        }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#4FC3F7' }}>
            VP Periodic Backtest
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#888' }}>
              {symbol} @ {interval}min
            </span>
            <button
              onClick={() => setMinimized(true)}
              title="Minimizar"
              style={{
                background: 'none', border: 'none', color: '#888',
                cursor: 'pointer', fontSize: '16px', padding: '0 4px',
              }}
            >_</button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: '#888',
                cursor: 'pointer', fontSize: '18px', padding: '0 4px',
              }}
            >X</button>
          </div>
        </div>

        <div style={{ padding: '16px' }}>
          {/* Strategy Selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '6px' }}>
              Estrategia
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {Object.entries(STRATEGIES).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => handleStrategyChange(key)}
                  style={{
                    flex: 1, padding: '8px 4px', border: 'none',
                    borderRadius: '4px', cursor: 'pointer', fontSize: '11px',
                    background: strategy === key ? '#4FC3F7' : '#2A2A4A',
                    color: strategy === key ? '#000' : '#CCC',
                    fontWeight: strategy === key ? 'bold' : 'normal',
                  }}
                >
                  {info.name}
                </button>
              ))}
            </div>
            <p style={{ fontSize: '10px', color: '#888', margin: '6px 0 0', lineHeight: '1.4' }}>
              {strategyInfo.description}
            </p>
          </div>

          {/* Days */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '4px' }}>
              Dias de datos: {days} (max: {maxDays})
            </label>
            <input
              type="range"
              min={1}
              max={maxDays}
              value={days}
              onChange={e => setDays(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
              <span>1</span>
              <span>{Math.round(maxDays / 2)}</span>
              <span>{maxDays}</span>
            </div>
          </div>

          {/* Strategy Params */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '8px' }}>
              Parametros de {strategyInfo.name}
            </label>
            {strategyInfo.params.map(p => (
              <div key={p.key} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                  <span style={{ color: '#CCC' }}>{p.label}</span>
                  <span style={{ color: '#4FC3F7', fontWeight: 'bold' }}>
                    {Number.isInteger(p.step) ? params[p.key] : (params[p.key] || 0).toFixed(p.step < 0.1 ? 2 : 1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={params[p.key] || p.min}
                  onChange={e => handleParamChange(p.key, e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            ))}
          </div>

          {/* Rolling VWAP Period */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '4px' }}>
              Rolling VWAP Period: <span style={{ color: '#4FC3F7', fontWeight: 'bold' }}>{vwapPeriod} velas</span>
            </label>
            <input
              type="range"
              min={5}
              max={200}
              step={5}
              value={vwapPeriod}
              onChange={e => setVwapPeriod(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
              <span>5</span>
              <span>50</span>
              <span>100</span>
              <span>200</span>
            </div>
          </div>

          {/* VWAP Filter (solo para estrategias con vwapFilterOptions) */}
          {strategyInfo.vwapFilterOptions && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '6px' }}>
                Filtro VWAP
              </label>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {Object.entries(strategyInfo.vwapFilterOptions).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => handleParamChange('vwap_filter', key)}
                    title={info.desc}
                    style={{
                      padding: '5px 10px', border: 'none', borderRadius: '4px',
                      cursor: 'pointer', fontSize: '11px',
                      background: (params.vwap_filter || 'vwap') === key ? '#FF9800' : '#2A2A4A',
                      color: (params.vwap_filter || 'vwap') === key ? '#000' : '#CCC',
                      fontWeight: (params.vwap_filter || 'vwap') === key ? 'bold' : 'normal',
                    }}
                  >
                    {info.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '10px', color: '#888', margin: '4px 0 0', lineHeight: '1.3' }}>
                {strategyInfo.vwapFilterOptions[params.vwap_filter || 'vwap']?.desc || ''}
              </p>
            </div>
          )}

          {/* Direction Filter (solo para vwap_swing) */}
          {strategyInfo.directionFilterOptions && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#A0A0A0', marginBottom: '6px' }}>
                Direccion
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {Object.entries(strategyInfo.directionFilterOptions).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => handleParamChange('direction_filter', key)}
                    title={info.desc}
                    style={{
                      flex: 1, padding: '5px 10px', border: 'none', borderRadius: '4px',
                      cursor: 'pointer', fontSize: '11px',
                      background: (params.direction_filter || 'both') === key ? '#9C27B0' : '#2A2A4A',
                      color: (params.direction_filter || 'both') === key ? '#FFF' : '#CCC',
                      fontWeight: (params.direction_filter || 'both') === key ? 'bold' : 'normal',
                    }}
                  >
                    {info.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={handleRunBacktest}
              disabled={loading}
              style={{
                flex: 1, padding: '10px', border: 'none', borderRadius: '4px',
                background: loading ? '#555' : '#4FC3F7', color: '#000',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold', fontSize: '13px',
              }}
            >
              {loading ? 'Ejecutando...' : 'Ejecutar Backtest'}
            </button>
            {result && (
              <button
                onClick={handleClearZones}
                style={{
                  padding: '10px 16px', border: '1px solid #555',
                  borderRadius: '4px', background: 'transparent',
                  color: '#CCC', cursor: 'pointer', fontSize: '12px',
                }}
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {progress && (
            <div style={{
              padding: '10px 12px', background: '#1E1E3A', borderRadius: '6px',
              marginBottom: '12px', border: '1px solid #2A2A4A',
            }}>
              {/* Barra de progreso */}
              <div style={{
                width: '100%', height: '22px', background: '#12122A',
                borderRadius: '11px', overflow: 'hidden', position: 'relative',
                marginBottom: '6px',
              }}>
                <div style={{
                  width: `${Math.max(progress.percent || 0, 2)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #1E88E5, #4FC3F7)',
                  borderRadius: '11px',
                  transition: 'width 0.4s ease',
                }} />
                <span style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontSize: '11px', fontWeight: 'bold', color: '#FFF',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {progress.percent || 0}%
                </span>
              </div>
              {/* Mensaje de fase */}
              <div style={{ fontSize: '11px', color: '#A0A0A0', textAlign: 'center' }}>
                {progress.message}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: '8px 12px', background: '#3A1E1E', borderRadius: '4px',
              fontSize: '12px', color: '#FF6B6B', marginBottom: '12px',
              border: '1px solid #FF3333',
            }}>
              {error}
            </div>
          )}

          {/* Results */}
          {stats && (
            <div style={{ marginTop: '4px' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '10px',
              }}>
                <span style={{ fontSize: '13px', color: '#4FC3F7', fontWeight: 'bold' }}>
                  Resultados
                </span>
                <span style={{ fontSize: '10px', color: '#888' }}>
                  {result.candles_count?.toLocaleString() || '?'} velas | {result.segments_count || '?'} segmentos VP | {result.elapsed_seconds || '?'}s
                </span>
              </div>

              {/* Stats Grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px', marginBottom: '12px',
              }}>
                {/* Win Rate */}
                <div style={{
                  background: '#2A2A4A', borderRadius: '6px', padding: '10px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: stats.win_rate >= 50 ? '#4CAF50' : '#FF5252' }}>
                    {stats.win_rate}%
                  </div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Win Rate</div>
                </div>

                {/* Total PnL */}
                <div style={{
                  background: '#2A2A4A', borderRadius: '6px', padding: '10px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: stats.total_pnl_r >= 0 ? '#4CAF50' : '#FF5252' }}>
                    {stats.total_pnl_r > 0 ? '+' : ''}{stats.total_pnl_r}R
                  </div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Total PnL</div>
                </div>

                {/* Expectancy */}
                <div style={{
                  background: '#2A2A4A', borderRadius: '6px', padding: '10px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: stats.expectancy >= 0 ? '#4CAF50' : '#FF5252' }}>
                    {stats.expectancy > 0 ? '+' : ''}{stats.expectancy}
                  </div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Expectancy</div>
                </div>
              </div>

              {/* Detailed Stats Table */}
              <div style={{
                background: '#2A2A4A', borderRadius: '6px', padding: '10px',
                fontSize: '11px',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      ['Trades', `${stats.closed} cerrados (${stats.wins}W / ${stats.losses}L)${stats.open ? ` + ${stats.open} open` : ''}`],
                      ['Profit Factor', stats.profit_factor],
                      ['Max Drawdown', `${stats.max_drawdown_r}R`],
                      ['Avg Winner', `${stats.avg_winner_r}R`],
                      ['Avg Loser', `${stats.avg_loser_r}R`],
                      ['Max Consec W/L', `${stats.max_consec_wins} / ${stats.max_consec_losses}`],
                      ['Avg Bars Held', stats.avg_bars_held],
                    ].map(([label, value], i) => (
                      <tr key={i}>
                        <td style={{ padding: '3px 6px', color: '#A0A0A0', borderBottom: '1px solid #333' }}>{label}</td>
                        <td style={{ padding: '3px 6px', color: '#E0E0E0', textAlign: 'right', borderBottom: '1px solid #333', fontWeight: 'bold' }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Trade List Toggle + Zones Info */}
              <div style={{
                marginTop: '10px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <button
                  onClick={() => setShowTradeList(!showTradeList)}
                  style={{
                    background: showTradeList ? '#4FC3F7' : '#2A2A4A',
                    color: showTradeList ? '#000' : '#CCC',
                    border: 'none', borderRadius: '4px', padding: '6px 12px',
                    cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                  }}
                >
                  {showTradeList ? 'Ocultar trades' : `Ver trades (${tradesWithCumulative.length})`}
                </button>
                <span style={{ fontSize: '10px', color: '#888' }}>
                  {result.zones?.length || 0} zonas en chart | Click trade = ir al chart
                </span>
              </div>

              {/* Trade List */}
              {showTradeList && tradesWithCumulative.length > 0 && (
                <div style={{
                  marginTop: '10px', background: '#12122A', borderRadius: '6px',
                  border: '1px solid #2A2A4A', maxHeight: '300px', overflow: 'auto',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                    <thead>
                      <tr style={{ background: '#1A1A3A', position: 'sticky', top: 0, zIndex: 1 }}>
                        {['#', 'Fecha', 'Dir', 'Entry', 'Result', 'PnL', 'Acum', 'Bars'].map(h => (
                          <th key={h} style={{
                            padding: '5px 4px', color: '#A0A0A0', fontWeight: 'normal',
                            borderBottom: '1px solid #333', textAlign: h === '#' ? 'center' : 'right',
                            ...(h === 'Fecha' ? { textAlign: 'left' } : {}),
                            ...(h === 'Dir' || h === 'Result' ? { textAlign: 'center' } : {}),
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tradesWithCumulative.map((z, i) => {
                        const entryDate = z.entry_timestamp
                          ? new Date(z.entry_timestamp).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '-';
                        const entryTime = z.entry_timestamp
                          ? new Date(z.entry_timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                          : '';
                        const isWin = z.trade_result === 'WIN';
                        const isLoss = z.trade_result === 'LOSS';
                        const isOpen = z.trade_result === 'OPEN';
                        const dirColor = z.direction === 'UP' ? '#4CAF50' : '#FF5252';
                        const resultColor = isWin ? '#4CAF50' : isLoss ? '#FF5252' : '#FFD54F';
                        const pnl = z.trade_pnl_r || 0;

                        return (
                          <tr
                            key={i}
                            onClick={() => { handleTradeClick(z); setMinimized(true); }}
                            style={{
                              cursor: 'pointer',
                              background: i % 2 === 0 ? '#1A1A2E' : '#1E1E38',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#2A2A5A'}
                            onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#1A1A2E' : '#1E1E38'}
                          >
                            <td style={{ padding: '4px 4px', textAlign: 'center', color: '#888', borderBottom: '1px solid #222' }}>
                              {z.timeline_index || i + 1}
                            </td>
                            <td style={{ padding: '4px 4px', textAlign: 'left', color: '#CCC', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>
                              {entryDate} {entryTime}
                            </td>
                            <td style={{ padding: '4px 4px', textAlign: 'center', color: dirColor, fontWeight: 'bold', borderBottom: '1px solid #222' }}>
                              {z.direction === 'UP' ? 'L' : 'S'}
                            </td>
                            <td style={{ padding: '4px 4px', textAlign: 'right', color: '#CCC', borderBottom: '1px solid #222', fontFamily: 'monospace' }}>
                              {z.entry_price ? z.entry_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '-'}
                            </td>
                            <td style={{ padding: '4px 4px', textAlign: 'center', color: resultColor, fontWeight: 'bold', borderBottom: '1px solid #222' }}>
                              {isWin ? 'W' : isLoss ? 'L' : isOpen ? 'O' : z.trade_result}
                            </td>
                            <td style={{
                              padding: '4px 4px', textAlign: 'right', fontWeight: 'bold',
                              borderBottom: '1px solid #222', fontFamily: 'monospace',
                              color: pnl > 0 ? '#4CAF50' : pnl < 0 ? '#FF5252' : '#888',
                            }}>
                              {pnl > 0 ? '+' : ''}{pnl.toFixed(1)}R
                            </td>
                            <td style={{
                              padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace',
                              borderBottom: '1px solid #222',
                              color: z.cumPnl >= 0 ? '#4CAF50' : '#FF5252',
                            }}>
                              {z.cumPnl > 0 ? '+' : ''}{z.cumPnl.toFixed(1)}
                            </td>
                            <td style={{ padding: '4px 4px', textAlign: 'right', color: '#888', borderBottom: '1px solid #222' }}>
                              {z.bars_held || '-'}
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
        </div>
      </div>
    </div>
  );
};

export default VPPeriodicBacktestSettings;
