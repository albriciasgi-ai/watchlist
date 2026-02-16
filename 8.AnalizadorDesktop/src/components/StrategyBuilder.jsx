// StrategyBuilder.jsx
// Modal para construir estrategias modulares de backtesting
// 5 bloques: Niveles, Senal de Entrada, Filtros, Riesgo, Exit Rules

import React, { useState, useCallback, useEffect, useRef } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';

// =========================================================================
// Constantes de configuracion
// =========================================================================

const MAX_DAYS_BY_INTERVAL = {
  '1': 7, '3': 21, '5': 400, '15': 180, '30': 360,
  '60': 730, '120': 730, '240': 1095, 'D': 2000, 'W': 1000,
};

const DEFAULT_DAYS = {
  '1': 3, '3': 10, '5': 90, '15': 30, '30': 60,
  '60': 180, '120': 365, '240': 730, 'D': 1000, 'W': 500,
};

// --- Catalogo de Level Sources ---
const LEVEL_SOURCES = [
  {
    id: 'vp_periodic', label: 'VP Periodic',
    desc: 'POC, VAH, VAL por segmento de volumen',
    params: [
      { key: 'period', label: 'Period', min: 50, max: 1000, step: 10, default: 240 },
      { key: 'bins', label: 'Bins', min: 20, max: 100, step: 5, default: 50 },
    ],
  },
  {
    id: 'sr_v2', label: 'S&R v2',
    desc: 'Swing points clusterizados',
    params: [
      { key: 'swing_bars', label: 'Swing Bars', min: 2, max: 10, step: 1, default: 3 },
      { key: 'cluster_distance_pct', label: 'Cluster Dist %', min: 0.1, max: 2.0, step: 0.1, default: 0.3 },
      { key: 'min_touches', label: 'Min Touches', min: 1, max: 5, step: 1, default: 2 },
      { key: 'max_levels', label: 'Max Levels', min: 3, max: 20, step: 1, default: 10 },
      { key: 'recalc_every', label: 'Recalc Every', min: 20, max: 500, step: 20, default: 100 },
    ],
  },
  {
    id: 'vwap_bands', label: 'VWAP Bands',
    desc: 'VWAP + bandas sigma como niveles dinamicos',
    params: [],
  },
  {
    id: 'swing_levels', label: 'Swing Levels',
    desc: 'Swing Highs/Lows como S/R',
    params: [
      { key: 'swing_bars', label: 'Swing Bars', min: 2, max: 15, step: 1, default: 5 },
    ],
  },
  {
    id: 'dtb_neckline', label: 'DTB Neckline',
    desc: 'Double Top/Bottom necklines',
    params: [
      { key: 'candles_per_extreme', label: 'Candles/Extreme', min: 3, max: 15, step: 1, default: 5 },
      { key: 'price_margin_pct', label: 'Price Margin %', min: 0.5, max: 5.0, step: 0.5, default: 2.0 },
      { key: 'min_candles_between', label: 'Min Between', min: 5, max: 50, step: 5, default: 10 },
    ],
  },
];

// --- Catalogo de Entry Signals ---
const ENTRY_SIGNALS = [
  { id: 'price_touch', label: 'Price Touch', desc: 'Precio toca un nivel', params: [
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.15 },
  ]},
  { id: 'swing_confirm', label: 'Swing Confirm', desc: 'Swing low/high confirmado cerca de nivel', params: [
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.3 },
    { key: 'swing_bars', label: 'Swing Bars', min: 2, max: 10, step: 1, default: 3 },
  ]},
  { id: 'breakout_close', label: 'Breakout Close', desc: 'Cierre arriba/abajo de nivel', params: [
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.1 },
  ]},
  { id: 'rejection_candle', label: 'Rejection Candle', desc: 'Hammer/Shooting Star cerca de nivel', params: [
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.3 },
    { key: 'wick_body_ratio', label: 'Wick/Body Ratio', min: 1.0, max: 5.0, step: 0.5, default: 2.0 },
  ]},
  { id: 'pattern_match', label: 'Pattern Match', desc: 'Engulfing/Doji cerca de nivel', params: [
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.1, max: 1.0, step: 0.1, default: 0.3 },
    { key: 'pattern_type', label: 'Patron', type: 'select', options: ['engulfing', 'doji', 'any'], default: 'any' },
  ]},
  { id: 'squeeze_release', label: 'Squeeze Release', desc: 'TTM Squeeze se libera', params: [] },
  { id: 'cvd_divergence', label: 'CVD Divergence', desc: 'Divergencia precio/CVD', params: [
    { key: 'lookback', label: 'Lookback', min: 10, max: 50, step: 5, default: 20 },
  ]},
  { id: 'dtb_confirm', label: 'DTB Confirm', desc: 'Double Top/Bottom confirmado', params: [
    { key: 'lookback', label: 'Lookback', min: 10, max: 100, step: 10, default: 50 },
    { key: 'min_confidence', label: 'Min Confidence', min: 30, max: 90, step: 5, default: 50 },
  ]},
];

// --- Catalogo de Context Filters ---
const CONTEXT_FILTERS = [
  { id: 'vwap_trend', label: 'VWAP Trend', desc: 'VWAP subiendo=solo LONG, bajando=solo SHORT', params: [
    { key: 'lookback', label: 'Lookback', min: 5, max: 50, step: 5, default: 10 },
  ]},
  { id: 'vwap_position', label: 'VWAP Position', desc: 'Precio arriba/abajo de VWAP o banda', params: [
    { key: 'reference', label: 'Referencia', type: 'select', options: ['vwap', 'upper_1', 'upper_2', 'lower_1', 'lower_2'], default: 'vwap' },
  ]},
  { id: 'ttm_squeeze', label: 'TTM Squeeze', desc: 'Filtro por estado de squeeze', params: [
    { key: 'require_squeeze', label: 'Requiere Squeeze', type: 'toggle', default: true },
  ]},
  { id: 'bbwp_range', label: 'BBWP Range', desc: 'Percentil de volatilidad', params: [
    { key: 'min_val', label: 'Min', min: 0, max: 100, step: 5, default: 0 },
    { key: 'max_val', label: 'Max', min: 0, max: 100, step: 5, default: 50 },
  ]},
  { id: 'volume_zscore', label: 'Volume Z-Score', desc: 'Volumen anomalo', params: [
    { key: 'min_zscore', label: 'Min Z-Score', min: 0.5, max: 4.0, step: 0.5, default: 1.5 },
    { key: 'lookback', label: 'Lookback', min: 10, max: 50, step: 5, default: 20 },
  ]},
  { id: 'cvd_trend', label: 'CVD Trend', desc: 'CVD positivo=LONG, negativo=SHORT', params: [
    { key: 'lookback', label: 'Lookback', min: 10, max: 50, step: 5, default: 20 },
  ]},
  { id: 'dtb_bias', label: 'DTB Bias', desc: 'DTB reciente sesga direccion', params: [
    { key: 'lookback', label: 'Lookback', min: 10, max: 100, step: 10, default: 50 },
    { key: 'min_confidence', label: 'Min Confidence', min: 30, max: 90, step: 5, default: 50 },
  ]},
  { id: 'direction', label: 'Direction Filter', desc: 'Solo LONG, SHORT o BOTH', params: [
    { key: 'allowed', label: 'Direccion', type: 'select', options: ['both', 'long', 'short'], default: 'both' },
  ]},
];

// --- SL Methods ---
const SL_METHODS = [
  { id: 'below_level', label: 'Below Level', params: [
    { key: 'buffer_pct', label: 'Buffer %', min: 0.01, max: 1.0, step: 0.05, default: 0.1 },
  ]},
  { id: 'below_swing', label: 'Below Swing', params: [
    { key: 'buffer_pct', label: 'Buffer %', min: 0.01, max: 1.0, step: 0.05, default: 0.1 },
  ]},
  { id: 'atr_multiple', label: 'ATR Multiple', params: [
    { key: 'atr_multiplier', label: 'ATR Mult', min: 0.5, max: 5.0, step: 0.5, default: 1.5 },
  ]},
  { id: 'fixed_pct', label: 'Fixed %', params: [
    { key: 'fixed_pct', label: 'SL %', min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
  ]},
];

// --- TP Methods ---
const TP_METHODS = [
  { id: 'rr_fixed', label: 'R:R Fixed', params: [
    { key: 'rr', label: 'R:R Ratio', min: 0.5, max: 10.0, step: 0.5, default: 2.0 },
  ]},
  { id: 'opposite_level', label: 'Opposite Level', params: [
    { key: 'fallback_rr', label: 'Fallback R:R', min: 1.0, max: 5.0, step: 0.5, default: 2.0 },
  ]},
  { id: 'next_swing', label: 'Next Swing', params: [
    { key: 'fallback_rr', label: 'Fallback R:R', min: 1.0, max: 5.0, step: 0.5, default: 2.0 },
  ]},
  { id: 'atr_multiple', label: 'ATR Multiple', params: [
    { key: 'atr_multiplier', label: 'ATR Mult', min: 1.0, max: 10.0, step: 0.5, default: 3.0 },
  ]},
  { id: 'fixed_pct', label: 'Fixed %', params: [
    { key: 'fixed_pct', label: 'TP %', min: 0.5, max: 10.0, step: 0.5, default: 2.0 },
  ]},
];

// --- Exit Rules ---
const EXIT_RULES = [
  { id: 'vwap_reverse', label: 'VWAP Reverse', desc: 'VWAP cambia de direccion', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 30, step: 1, default: 10 },
  ]},
  { id: 'reenter_zone', label: 'Re-enter Zone', desc: 'Precio vuelve al nivel de entrada', params: [] },
  { id: 'squeeze_activate', label: 'Squeeze Activate', desc: 'TTM Squeeze se activa durante trade', params: [] },
  { id: 'timeout', label: 'Timeout', desc: 'Max barras en trade', params: [
    { key: 'max_bars', label: 'Max Bars', min: 10, max: 500, step: 10, default: 50 },
  ]},
];

// --- Colores del tema ---
const COLORS = {
  bg: '#1A1A2E',
  bgHeader: '#12122A',
  bgCard: '#2A2A4A',
  bgInput: '#1E1E3A',
  text: '#E0E0E0',
  textSec: '#A0A0A0',
  accent: '#9C27B0',    // Purpura - branding del Strategy Builder
  accentLight: '#CE93D8',
  win: '#4CAF50',
  loss: '#FF5252',
  open: '#FFD54F',
  border: '#3A3A5A',
};

// =========================================================================
// Helpers
// =========================================================================

function buildConfigPayload(state) {
  const config = {
    level_sources: [],
    entry_signal: {
      signal_type: state.entrySignalType,
      params: { ...state.entrySignalParams },
    },
    context_filters: [],
    risk: {
      sl_method: state.slMethod,
      sl_params: { ...state.slParams },
      tp_method: state.tpMethod,
      tp_params: { ...state.tpParams },
      max_trades_per_segment: state.maxTradesPerSegment,
      trailing_stop: state.trailingStop,
    },
    exit_rules: [],
    confluence_mode: state.confluenceMode,
    min_confluence_score: state.minConfluenceScore,
    vwap_period: state.vwapPeriod,
  };

  // Level sources
  for (const ls of LEVEL_SOURCES) {
    if (state.levelSources[ls.id]) {
      config.level_sources.push({
        source: ls.id,
        enabled: true,
        params: { ...(state.levelParams[ls.id] || {}) },
      });
    }
  }

  // Context filters
  for (const cf of CONTEXT_FILTERS) {
    if (state.contextFilters[cf.id]) {
      config.context_filters.push({
        filter_type: cf.id,
        enabled: true,
        params: { ...(state.filterParams[cf.id] || {}) },
      });
    }
  }

  // Exit rules
  for (const er of EXIT_RULES) {
    if (state.exitRules[er.id]) {
      config.exit_rules.push({
        rule_type: er.id,
        enabled: true,
        params: { ...(state.exitRuleParams[er.id] || {}) },
      });
    }
  }

  return config;
}

function getDefaults(catalog) {
  const out = {};
  for (const item of catalog) {
    const d = {};
    for (const p of (item.params || [])) {
      d[p.key] = p.default;
    }
    out[item.id] = d;
  }
  return out;
}

// =========================================================================
// Componente principal
// =========================================================================

const StrategyBuilder = ({ isOpen, onClose, symbol, interval, indicatorManager }) => {
  // --- State ---
  const [days, setDays] = useState(() => DEFAULT_DAYS[interval] || 90);
  const [vwapPeriod, setVwapPeriod] = useState(20);

  // Block 1: Level Sources
  const [levelSources, setLevelSources] = useState({ vp_periodic: true });
  const [levelParams, setLevelParams] = useState(() => getDefaults(LEVEL_SOURCES));

  // Block 2: Entry Signal
  const [entrySignalType, setEntrySignalType] = useState('price_touch');
  const [entrySignalParams, setEntrySignalParams] = useState(() => {
    const p = {};
    for (const s of ENTRY_SIGNALS) { for (const pp of s.params) p[pp.key] = pp.default; }
    return p;
  });

  // Block 3: Context Filters
  const [contextFilters, setContextFilters] = useState({});
  const [filterParams, setFilterParams] = useState(() => getDefaults(CONTEXT_FILTERS));

  // Block 4: Risk
  const [slMethod, setSlMethod] = useState('below_level');
  const [slParams, setSlParams] = useState({ buffer_pct: 0.1 });
  const [tpMethod, setTpMethod] = useState('rr_fixed');
  const [tpParams, setTpParams] = useState({ rr: 2.0 });
  const [maxTradesPerSegment, setMaxTradesPerSegment] = useState(1);
  const [trailingStop, setTrailingStop] = useState(false);

  // Block 5: Exit Rules
  const [exitRules, setExitRules] = useState({});
  const [exitRuleParams, setExitRuleParams] = useState(() => getDefaults(EXIT_RULES));

  // Confluence
  const [confluenceMode, setConfluenceMode] = useState('any');
  const [minConfluenceScore, setMinConfluenceScore] = useState(0);

  // UI state
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [showTradeList, setShowTradeList] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState({ levels: true });

  // Optimizer state
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optParamRanges, setOptParamRanges] = useState({});
  const [optMetric, setOptMetric] = useState('expectancy');
  const [optEstimate, setOptEstimate] = useState(null);
  const [optResults, setOptResults] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState(null);

  const abortRef = useRef(null);

  // Update days when interval changes
  useEffect(() => {
    setDays(DEFAULT_DAYS[interval] || 90);
  }, [interval]);

  const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 365;

  // --- Handlers ---

  const toggleBlock = useCallback((block) => {
    setExpandedBlocks(prev => ({ ...prev, [block]: !prev[block] }));
  }, []);

  const handleRunBacktest = useCallback(async () => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (!manager) { setError('IndicatorManager no disponible'); return; }

    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ phase: 'connecting', percent: 0, message: 'Conectando...' });

    const config = buildConfigPayload({
      levelSources, levelParams, entrySignalType, entrySignalParams,
      contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
      maxTradesPerSegment, trailingStop, exitRules, exitRuleParams,
      confluenceMode, minConfluenceScore, vwapPeriod,
    });

    try {
      const res = await manager.runStrategyBuilderBacktest({
        days,
        config,
        _onProgress: (p) => setProgress(p),
      });

      if (res && res.success) {
        setResult(res);
      } else {
        setError(res?.error || 'Error desconocido');
      }
    } catch (e) {
      setError(e.message || 'Error de conexion');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [
    indicatorManager, symbol, days, levelSources, levelParams, entrySignalType,
    entrySignalParams, contextFilters, filterParams, slMethod, slParams,
    tpMethod, tpParams, maxTradesPerSegment, trailingStop, exitRules,
    exitRuleParams, confluenceMode, minConfluenceScore, vwapPeriod,
  ]);

  const handleTradeClick = useCallback((zone) => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (manager && zone.entry_timestamp) {
      manager.navigateToTimestamp(zone.entry_timestamp);
      setMinimized(true);
    }
  }, [indicatorManager, symbol]);

  const handleClearZones = useCallback(() => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (manager && manager.zoneVisualizerIndicator) {
      manager.zoneVisualizerIndicator.setStrategyZones([]);
      manager.requestRedraw();
    }
    setResult(null);
  }, [indicatorManager, symbol]);

  // --- Optimizer handlers ---

  const handleEstimateOptimize = useCallback(async () => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (!manager) return;

    const activeRanges = {};
    for (const [key, range] of Object.entries(optParamRanges)) {
      if (range.enabled) {
        activeRanges[key] = { min: range.min, max: range.max, step: range.step };
      }
    }
    if (Object.keys(activeRanges).length === 0) {
      setOptError('Selecciona al menos un parametro para optimizar');
      return;
    }

    const config = buildConfigPayload({
      levelSources, levelParams, entrySignalType, entrySignalParams,
      contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
      maxTradesPerSegment, trailingStop, exitRules, exitRuleParams,
      confluenceMode, minConfluenceScore, vwapPeriod,
    });

    setOptLoading(true);
    setOptError(null);
    setOptEstimate(null);
    setOptResults(null);

    try {
      const est = await manager.estimateStrategyOptimization({
        days, config, param_ranges: activeRanges,
      });
      if (est && est.success) {
        setOptEstimate(est);
      } else {
        setOptError(est?.error || 'Error estimando');
      }
    } catch (e) {
      setOptError(e.message);
    } finally {
      setOptLoading(false);
    }
  }, [
    indicatorManager, symbol, days, optParamRanges, levelSources, levelParams,
    entrySignalType, entrySignalParams, contextFilters, filterParams,
    slMethod, slParams, tpMethod, tpParams, maxTradesPerSegment, trailingStop,
    exitRules, exitRuleParams, confluenceMode, minConfluenceScore, vwapPeriod,
  ]);

  const handleRunOptimize = useCallback(async () => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (!manager) return;

    const activeRanges = {};
    for (const [key, range] of Object.entries(optParamRanges)) {
      if (range.enabled) {
        activeRanges[key] = { min: range.min, max: range.max, step: range.step };
      }
    }

    const config = buildConfigPayload({
      levelSources, levelParams, entrySignalType, entrySignalParams,
      contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
      maxTradesPerSegment, trailingStop, exitRules, exitRuleParams,
      confluenceMode, minConfluenceScore, vwapPeriod,
    });

    setOptLoading(true);
    setOptError(null);
    setOptResults(null);

    try {
      await manager.optimizeStrategyBuilder({
        days, config, param_ranges: activeRanges,
        metric: optMetric, top_n: 15,
        onComplete: (res) => {
          setOptResults(res);
          setOptLoading(false);
        },
        onError: (err) => {
          setOptError(err);
          setOptLoading(false);
        },
      });
    } catch (e) {
      setOptError(e.message);
      setOptLoading(false);
    }
  }, [
    indicatorManager, symbol, days, optParamRanges, optMetric,
    levelSources, levelParams, entrySignalType, entrySignalParams,
    contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
    maxTradesPerSegment, trailingStop, exitRules, exitRuleParams,
    confluenceMode, minConfluenceScore, vwapPeriod,
  ]);

  const applyOptResult = useCallback((row) => {
    const params = row.params || {};
    // Aplicar params a los estados correspondientes
    for (const [key, val] of Object.entries(params)) {
      // Buscar en level sources
      for (const ls of LEVEL_SOURCES) {
        for (const p of ls.params) {
          if (key === `level.${ls.id}.${p.key}`) {
            setLevelParams(prev => ({
              ...prev,
              [ls.id]: { ...(prev[ls.id] || {}), [p.key]: val }
            }));
          }
        }
      }
      // Buscar en entry signal
      for (const es of ENTRY_SIGNALS) {
        for (const p of es.params) {
          if (key === `entry.${p.key}`) {
            setEntrySignalParams(prev => ({ ...prev, [p.key]: val }));
          }
        }
      }
      // Risk params
      if (key === 'risk.sl_params.buffer_pct') setSlParams(prev => ({ ...prev, buffer_pct: val }));
      if (key === 'risk.sl_params.atr_multiplier') setSlParams(prev => ({ ...prev, atr_multiplier: val }));
      if (key === 'risk.sl_params.fixed_pct') setSlParams(prev => ({ ...prev, fixed_pct: val }));
      if (key === 'risk.tp_params.rr') setTpParams(prev => ({ ...prev, rr: val }));
      if (key === 'risk.tp_params.atr_multiplier') setTpParams(prev => ({ ...prev, atr_multiplier: val }));
      if (key === 'risk.tp_params.fixed_pct') setTpParams(prev => ({ ...prev, fixed_pct: val }));
      if (key === 'risk.tp_params.fallback_rr') setTpParams(prev => ({ ...prev, fallback_rr: val }));
      if (key === 'vwap_period') setVwapPeriod(val);
    }
  }, []);

  // --- No render si cerrado ---
  if (!isOpen) return null;

  // --- Minimized view ---
  if (minimized) {
    const stats = result?.stats;
    return (
      <div style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 10002,
        background: COLORS.bgHeader, border: `1px solid ${COLORS.accent}`,
        borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
        onClick={() => setMinimized(false)}
      >
        <span style={{ color: COLORS.accent, fontWeight: 'bold', fontSize: 13 }}>Strategy Builder</span>
        {stats && (
          <>
            <span style={{ color: stats.win_rate >= 50 ? COLORS.win : COLORS.loss, fontWeight: 'bold' }}>
              WR {stats.win_rate.toFixed(1)}%
            </span>
            <span style={{ color: stats.total_pnl_r >= 0 ? COLORS.win : COLORS.loss }}>
              {stats.total_pnl_r >= 0 ? '+' : ''}{stats.total_pnl_r.toFixed(1)}R
            </span>
          </>
        )}
        <span style={{ color: COLORS.textSec, fontSize: 11 }}>click para expandir</span>
      </div>
    );
  }

  const stats = result?.stats;
  const trades = result?.trades || [];
  const modalWidth = showTradeList ? 840 : 560;

  // =========================================================================
  // Render helpers
  // =========================================================================

  const renderSlider = (param, value, onChange) => (
    <div key={param.key} style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.textSec }}>
        <span>{param.label}</span>
        <span style={{ color: COLORS.accentLight, fontWeight: 'bold' }}>
          {typeof value === 'number' ? (Number.isInteger(param.step) ? value : value.toFixed(2)) : value}
        </span>
      </div>
      <input type="range"
        min={param.min} max={param.max} step={param.step}
        value={value}
        onChange={(e) => onChange(param.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: '100%', accentColor: COLORS.accent }}
      />
    </div>
  );

  const renderParamControl = (param, value, onChange) => {
    if (param.type === 'select') {
      return (
        <div key={param.key} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 2 }}>{param.label}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {param.options.map(opt => (
              <button key={opt}
                onClick={() => onChange(opt)}
                style={{
                  padding: '3px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                  fontSize: 11, fontWeight: value === opt ? 'bold' : 'normal',
                  background: value === opt ? COLORS.accent : COLORS.bgInput,
                  color: value === opt ? '#FFF' : COLORS.textSec,
                }}
              >{opt}</button>
            ))}
          </div>
        </div>
      );
    }
    if (param.type === 'toggle') {
      return (
        <div key={param.key} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textSec }}>{param.label}</span>
          <button
            onClick={() => onChange(!value)}
            style={{
              padding: '2px 12px', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11,
              background: value ? COLORS.win : COLORS.bgInput,
              color: value ? '#000' : COLORS.textSec,
            }}
          >{value ? 'ON' : 'OFF'}</button>
        </div>
      );
    }
    return renderSlider(param, value, onChange);
  };

  // Section header with collapse
  const renderBlockHeader = (key, label, icon, count) => (
    <div
      onClick={() => toggleBlock(key)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', background: COLORS.bgCard, borderRadius: 4,
        cursor: 'pointer', marginBottom: expandedBlocks[key] ? 6 : 0,
        borderLeft: `3px solid ${COLORS.accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 'bold', color: COLORS.text }}>{label}</span>
        {count > 0 && (
          <span style={{
            fontSize: 10, background: COLORS.accent, color: '#FFF',
            borderRadius: 8, padding: '1px 6px', fontWeight: 'bold',
          }}>{count}</span>
        )}
      </div>
      <span style={{ color: COLORS.textSec, fontSize: 12 }}>{expandedBlocks[key] ? '\u25B2' : '\u25BC'}</span>
    </div>
  );

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div style={{
      position: 'fixed', top: 40, right: 16, zIndex: 10001,
      width: modalWidth, maxHeight: 'calc(100vh - 60px)',
      background: COLORS.bg, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      transition: 'width 0.2s ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: COLORS.bgHeader, borderRadius: '8px 8px 0 0',
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{'\u{1F9E9}'}</span>
          <span style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.accentLight }}>Strategy Builder</span>
          <span style={{ fontSize: 11, color: COLORS.textSec }}>{symbol} @ {interval}m</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMinimized(true)} style={{
            background: 'none', border: 'none', color: COLORS.textSec, cursor: 'pointer', fontSize: 16
          }}>_</button>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: COLORS.textSec, cursor: 'pointer', fontSize: 16
          }}>X</button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 14px',
        display: 'flex', gap: 10,
      }}>
        {/* Left column: Config blocks */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Days slider */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.textSec }}>
              <span>Dias de historico</span>
              <span style={{ color: COLORS.accentLight, fontWeight: 'bold' }}>{days}</span>
            </div>
            <input type="range" min={1} max={maxDays} step={1} value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666' }}>
              <span>1</span><span>{Math.round(maxDays / 2)}</span><span>{maxDays}</span>
            </div>
          </div>

          {/* VWAP Period */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.textSec }}>
              <span>VWAP Period (rolling)</span>
              <span style={{ color: COLORS.accentLight, fontWeight: 'bold' }}>{vwapPeriod}</span>
            </div>
            <input type="range" min={5} max={200} step={5} value={vwapPeriod}
              onChange={(e) => setVwapPeriod(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent }}
            />
          </div>

          {/* ============================================ */}
          {/* BLOCK 1: Level Sources */}
          {/* ============================================ */}
          {renderBlockHeader('levels', 'Niveles de Referencia', '\u{1F4CD}',
            Object.values(levelSources).filter(Boolean).length)}
          {expandedBlocks.levels && (
            <div style={{ padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8 }}>
              {LEVEL_SOURCES.map(ls => (
                <div key={ls.id} style={{ marginBottom: 6 }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    fontSize: 12, color: levelSources[ls.id] ? COLORS.text : COLORS.textSec,
                  }}>
                    <input type="checkbox" checked={!!levelSources[ls.id]}
                      onChange={(e) => setLevelSources(prev => ({ ...prev, [ls.id]: e.target.checked }))}
                      style={{ accentColor: COLORS.accent }}
                    />
                    <span style={{ fontWeight: levelSources[ls.id] ? 'bold' : 'normal' }}>{ls.label}</span>
                    <span style={{ fontSize: 10, color: '#777' }}>- {ls.desc}</span>
                  </label>
                  {levelSources[ls.id] && ls.params.length > 0 && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      {ls.params.map(p => renderSlider(p,
                        (levelParams[ls.id] || {})[p.key] ?? p.default,
                        (val) => setLevelParams(prev => ({
                          ...prev, [ls.id]: { ...(prev[ls.id] || {}), [p.key]: val }
                        }))
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Confluence */}
              <div style={{ marginTop: 8, padding: '6px 8px', background: COLORS.bgInput, borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 4 }}>Confluencia</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {['any', 'score'].map(m => (
                    <button key={m} onClick={() => setConfluenceMode(m)} style={{
                      padding: '3px 10px', border: 'none', borderRadius: 3, cursor: 'pointer',
                      fontSize: 11, fontWeight: confluenceMode === m ? 'bold' : 'normal',
                      background: confluenceMode === m ? COLORS.accent : COLORS.bgCard,
                      color: confluenceMode === m ? '#FFF' : COLORS.textSec,
                    }}>{m === 'any' ? 'Cualquier nivel' : 'Score minimo'}</button>
                  ))}
                </div>
                {confluenceMode === 'score' && renderSlider(
                  { key: 'minScore', label: 'Min Score', min: 0, max: 100, step: 5 },
                  minConfluenceScore,
                  setMinConfluenceScore
                )}
              </div>
            </div>
          )}

          {/* ============================================ */}
          {/* BLOCK 2: Entry Signal */}
          {/* ============================================ */}
          {renderBlockHeader('entry', 'Senal de Entrada', '\u{1F3AF}', 1)}
          {expandedBlocks.entry && (
            <div style={{ padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {ENTRY_SIGNALS.map(es => (
                  <button key={es.id} onClick={() => setEntrySignalType(es.id)} title={es.desc}
                    style={{
                      padding: '4px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                      fontSize: 11, fontWeight: entrySignalType === es.id ? 'bold' : 'normal',
                      background: entrySignalType === es.id ? COLORS.accent : COLORS.bgCard,
                      color: entrySignalType === es.id ? '#FFF' : COLORS.textSec,
                    }}
                  >{es.label}</button>
                ))}
              </div>
              {/* Params for selected signal */}
              {(() => {
                const sel = ENTRY_SIGNALS.find(s => s.id === entrySignalType);
                if (!sel || sel.params.length === 0) return null;
                return (
                  <div style={{ paddingLeft: 8 }}>
                    {sel.params.map(p => renderParamControl(p,
                      entrySignalParams[p.key] ?? p.default,
                      (val) => setEntrySignalParams(prev => ({ ...prev, [p.key]: val }))
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ============================================ */}
          {/* BLOCK 3: Context Filters */}
          {/* ============================================ */}
          {renderBlockHeader('filters', 'Filtros de Contexto', '\u{1F50D}',
            Object.values(contextFilters).filter(Boolean).length)}
          {expandedBlocks.filters && (
            <div style={{ padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8 }}>
              {CONTEXT_FILTERS.map(cf => (
                <div key={cf.id} style={{ marginBottom: 6 }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    fontSize: 12, color: contextFilters[cf.id] ? COLORS.text : COLORS.textSec,
                  }}>
                    <input type="checkbox" checked={!!contextFilters[cf.id]}
                      onChange={(e) => setContextFilters(prev => ({ ...prev, [cf.id]: e.target.checked }))}
                      style={{ accentColor: COLORS.accent }}
                    />
                    <span style={{ fontWeight: contextFilters[cf.id] ? 'bold' : 'normal' }}>{cf.label}</span>
                    <span style={{ fontSize: 10, color: '#777' }}>- {cf.desc}</span>
                  </label>
                  {contextFilters[cf.id] && cf.params.length > 0 && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      {cf.params.map(p => renderParamControl(p,
                        (filterParams[cf.id] || {})[p.key] ?? p.default,
                        (val) => setFilterParams(prev => ({
                          ...prev, [cf.id]: { ...(prev[cf.id] || {}), [p.key]: val }
                        }))
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ============================================ */}
          {/* BLOCK 4: Risk Management */}
          {/* ============================================ */}
          {renderBlockHeader('risk', 'Gestion de Riesgo', '\u{1F6E1}\u{FE0F}', 0)}
          {expandedBlocks.risk && (
            <div style={{ padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8 }}>
              {/* SL Method */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 4 }}>Stop Loss</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {SL_METHODS.map(m => (
                    <button key={m.id} onClick={() => {
                      setSlMethod(m.id);
                      const d = {};
                      for (const p of m.params) d[p.key] = p.default;
                      setSlParams(d);
                    }}
                      style={{
                        padding: '3px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                        fontSize: 11, fontWeight: slMethod === m.id ? 'bold' : 'normal',
                        background: slMethod === m.id ? '#D32F2F' : COLORS.bgCard,
                        color: slMethod === m.id ? '#FFF' : COLORS.textSec,
                      }}
                    >{m.label}</button>
                  ))}
                </div>
                {(() => {
                  const sel = SL_METHODS.find(m => m.id === slMethod);
                  if (!sel) return null;
                  return sel.params.map(p => renderSlider(p, slParams[p.key] ?? p.default,
                    (val) => setSlParams(prev => ({ ...prev, [p.key]: val }))
                  ));
                })()}
              </div>

              {/* TP Method */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 4 }}>Take Profit</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {TP_METHODS.map(m => (
                    <button key={m.id} onClick={() => {
                      setTpMethod(m.id);
                      const d = {};
                      for (const p of m.params) d[p.key] = p.default;
                      setTpParams(d);
                    }}
                      style={{
                        padding: '3px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                        fontSize: 11, fontWeight: tpMethod === m.id ? 'bold' : 'normal',
                        background: tpMethod === m.id ? '#2E7D32' : COLORS.bgCard,
                        color: tpMethod === m.id ? '#FFF' : COLORS.textSec,
                      }}
                    >{m.label}</button>
                  ))}
                </div>
                {(() => {
                  const sel = TP_METHODS.find(m => m.id === tpMethod);
                  if (!sel) return null;
                  return sel.params.map(p => renderSlider(p, tpParams[p.key] ?? p.default,
                    (val) => setTpParams(prev => ({ ...prev, [p.key]: val }))
                  ));
                })()}
              </div>

              {/* Max trades per segment */}
              {renderSlider(
                { key: 'mts', label: 'Max Trades/Segmento', min: 1, max: 10, step: 1 },
                maxTradesPerSegment, setMaxTradesPerSegment
              )}

              {/* Trailing stop */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: COLORS.textSec }}>Trailing Stop</span>
                <button onClick={() => setTrailingStop(!trailingStop)} style={{
                  padding: '2px 12px', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11,
                  background: trailingStop ? COLORS.win : COLORS.bgInput,
                  color: trailingStop ? '#000' : COLORS.textSec,
                }}>{trailingStop ? 'ON' : 'OFF'}</button>
              </div>
            </div>
          )}

          {/* ============================================ */}
          {/* BLOCK 5: Exit Rules */}
          {/* ============================================ */}
          {renderBlockHeader('exits', 'Exit Rules', '\u{1F6AA}',
            Object.values(exitRules).filter(Boolean).length)}
          {expandedBlocks.exits && (
            <div style={{ padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 8 }}>
              {EXIT_RULES.map(er => (
                <div key={er.id} style={{ marginBottom: 6 }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    fontSize: 12, color: exitRules[er.id] ? COLORS.text : COLORS.textSec,
                  }}>
                    <input type="checkbox" checked={!!exitRules[er.id]}
                      onChange={(e) => setExitRules(prev => ({ ...prev, [er.id]: e.target.checked }))}
                      style={{ accentColor: COLORS.accent }}
                    />
                    <span style={{ fontWeight: exitRules[er.id] ? 'bold' : 'normal' }}>{er.label}</span>
                    <span style={{ fontSize: 10, color: '#777' }}>- {er.desc}</span>
                  </label>
                  {exitRules[er.id] && er.params.length > 0 && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      {er.params.map(p => renderSlider(p,
                        (exitRuleParams[er.id] || {})[p.key] ?? p.default,
                        (val) => setExitRuleParams(prev => ({
                          ...prev, [er.id]: { ...(prev[er.id] || {}), [p.key]: val }
                        }))
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ============================================ */}
          {/* Actions */}
          {/* ============================================ */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, marginBottom: 8 }}>
            <button onClick={handleRunBacktest} disabled={loading}
              style={{
                flex: 1, padding: '10px 0', border: 'none', borderRadius: 4, cursor: loading ? 'wait' : 'pointer',
                fontWeight: 'bold', fontSize: 13,
                background: loading ? COLORS.bgCard : COLORS.accent,
                color: '#FFF',
              }}
            >{loading ? 'Ejecutando...' : 'Run Backtest'}</button>
            <button onClick={() => setShowOptimizer(!showOptimizer)}
              style={{
                padding: '10px 12px', border: `1px solid ${COLORS.accent}`, borderRadius: 4,
                cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
                background: showOptimizer ? COLORS.accent : 'transparent',
                color: showOptimizer ? '#FFF' : COLORS.accent,
              }}
            >Optimizer</button>
            {result && (
              <button onClick={handleClearZones} title="Limpiar zonas del chart"
                style={{
                  padding: '10px 12px', border: `1px solid ${COLORS.border}`, borderRadius: 4,
                  cursor: 'pointer', fontSize: 12, background: 'transparent', color: COLORS.textSec,
                }}
              >Limpiar</button>
            )}
          </div>

          {/* Progress bar */}
          {progress && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 2 }}>{progress.message || 'Procesando...'}</div>
              <div style={{ height: 6, background: COLORS.bgCard, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${progress.percent || 0}%`, height: '100%',
                  background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.accentLight})`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: '8px 10px', background: 'rgba(255,50,50,0.15)', border: '1px solid #FF5252',
              borderRadius: 4, fontSize: 12, color: '#FF5252', marginBottom: 8,
            }}>{error}</div>
          )}

          {/* ============================================ */}
          {/* Optimizer Section */}
          {/* ============================================ */}
          {showOptimizer && (
            <div style={{
              padding: '10px', background: COLORS.bgInput, borderRadius: 6,
              border: `1px solid ${COLORS.accent}40`, marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: COLORS.accentLight, marginBottom: 8 }}>
                Grid Search Optimizer
              </div>

              {/* Optimizable params: collect from all active blocks */}
              <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 6 }}>
                Selecciona parametros a optimizar:
              </div>

              {/* Collect all optimizable params */}
              {(() => {
                const allParams = [];
                // Level source params
                for (const ls of LEVEL_SOURCES) {
                  if (levelSources[ls.id]) {
                    for (const p of ls.params) {
                      allParams.push({
                        path: `level.${ls.id}.${p.key}`,
                        label: `${ls.label} > ${p.label}`,
                        ...p,
                      });
                    }
                  }
                }
                // Entry signal params
                const selSignal = ENTRY_SIGNALS.find(s => s.id === entrySignalType);
                if (selSignal) {
                  for (const p of selSignal.params) {
                    if (p.type !== 'select' && p.type !== 'toggle') {
                      allParams.push({
                        path: `entry.${p.key}`,
                        label: `Entry > ${p.label}`,
                        ...p,
                      });
                    }
                  }
                }
                // Risk params
                const selSL = SL_METHODS.find(m => m.id === slMethod);
                if (selSL) {
                  for (const p of selSL.params) {
                    allParams.push({
                      path: `risk.sl_params.${p.key}`,
                      label: `SL > ${p.label}`,
                      ...p,
                    });
                  }
                }
                const selTP = TP_METHODS.find(m => m.id === tpMethod);
                if (selTP) {
                  for (const p of selTP.params) {
                    allParams.push({
                      path: `risk.tp_params.${p.key}`,
                      label: `TP > ${p.label}`,
                      ...p,
                    });
                  }
                }
                // VWAP period
                allParams.push({
                  path: 'vwap_period',
                  label: 'VWAP Period',
                  min: 5, max: 200, step: 5, default: 20,
                });

                if (allParams.length === 0) {
                  return <div style={{ fontSize: 11, color: '#777' }}>No hay parametros optimizables</div>;
                }

                return allParams.map(p => {
                  const range = optParamRanges[p.path] || { enabled: false, min: p.min, max: p.max, step: p.step };
                  return (
                    <div key={p.path} style={{ marginBottom: 6, paddingLeft: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                        <input type="checkbox" checked={range.enabled}
                          onChange={(e) => setOptParamRanges(prev => ({
                            ...prev, [p.path]: { ...range, enabled: e.target.checked }
                          }))}
                          style={{ accentColor: COLORS.accent }}
                        />
                        <span style={{ color: range.enabled ? COLORS.text : COLORS.textSec }}>{p.label}</span>
                      </label>
                      {range.enabled && (
                        <div style={{ display: 'flex', gap: 6, paddingLeft: 20, marginTop: 2, fontSize: 10 }}>
                          <label style={{ color: COLORS.textSec }}>
                            Min: <input type="number" value={range.min} step={p.step} style={{ width: 50, background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 2, padding: '1px 3px' }}
                              onChange={(e) => setOptParamRanges(prev => ({ ...prev, [p.path]: { ...range, min: parseFloat(e.target.value) } }))} />
                          </label>
                          <label style={{ color: COLORS.textSec }}>
                            Max: <input type="number" value={range.max} step={p.step} style={{ width: 50, background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 2, padding: '1px 3px' }}
                              onChange={(e) => setOptParamRanges(prev => ({ ...prev, [p.path]: { ...range, max: parseFloat(e.target.value) } }))} />
                          </label>
                          <label style={{ color: COLORS.textSec }}>
                            Step: <input type="number" value={range.step} step={p.step} style={{ width: 50, background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 2, padding: '1px 3px' }}
                              onChange={(e) => setOptParamRanges(prev => ({ ...prev, [p.path]: { ...range, step: parseFloat(e.target.value) } }))} />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Metric selector */}
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 3 }}>Metrica objetivo:</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['expectancy', 'total_pnl_r', 'win_rate', 'profit_factor'].map(m => (
                    <button key={m} onClick={() => setOptMetric(m)} style={{
                      padding: '3px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                      fontSize: 10, fontWeight: optMetric === m ? 'bold' : 'normal',
                      background: optMetric === m ? COLORS.accent : COLORS.bgCard,
                      color: optMetric === m ? '#FFF' : COLORS.textSec,
                    }}>{m.replace(/_/g, ' ')}</button>
                  ))}
                </div>
              </div>

              {/* Estimate + Run buttons */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleEstimateOptimize} disabled={optLoading}
                  style={{
                    flex: 1, padding: '8px 0', border: 'none', borderRadius: 4,
                    cursor: optLoading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 'bold',
                    background: COLORS.bgCard, color: COLORS.accentLight,
                  }}
                >Estimar</button>
                {optEstimate && !optResults && (
                  <button onClick={handleRunOptimize} disabled={optLoading}
                    style={{
                      flex: 1, padding: '8px 0', border: 'none', borderRadius: 4,
                      cursor: optLoading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 'bold',
                      background: COLORS.accent, color: '#FFF',
                    }}
                  >Ejecutar</button>
                )}
              </div>

              {/* Estimate result */}
              {optEstimate && !optResults && (
                <div style={{
                  marginTop: 6, padding: '6px 8px', borderRadius: 4, fontSize: 11,
                  background: optEstimate.estimated_seconds < 60 ? 'rgba(76,175,80,0.15)'
                    : optEstimate.estimated_seconds < 300 ? 'rgba(255,193,7,0.15)' : 'rgba(244,67,54,0.15)',
                  color: optEstimate.estimated_seconds < 60 ? COLORS.win
                    : optEstimate.estimated_seconds < 300 ? COLORS.open : COLORS.loss,
                }}>
                  {optEstimate.total_combos} combos | ~{optEstimate.estimated_seconds.toFixed(0)}s | {optEstimate.candles} velas
                </div>
              )}

              {/* Opt error */}
              {optError && (
                <div style={{ marginTop: 6, fontSize: 11, color: COLORS.loss }}>{optError}</div>
              )}

              {/* Opt loading */}
              {optLoading && (
                <div style={{ marginTop: 6, fontSize: 11, color: COLORS.accentLight }}>Procesando...</div>
              )}

              {/* Opt results table */}
              {optResults && optResults.results && (
                <div style={{ marginTop: 8, maxHeight: 250, overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 4 }}>
                    Top {optResults.results.length} de {optResults.all_results_count} ({optResults.elapsed.toFixed(1)}s)
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ color: COLORS.textSec, borderBottom: `1px solid ${COLORS.border}` }}>
                        <th style={{ textAlign: 'left', padding: 2 }}>#</th>
                        <th style={{ textAlign: 'right', padding: 2 }}>WR%</th>
                        <th style={{ textAlign: 'right', padding: 2 }}>PnL</th>
                        <th style={{ textAlign: 'right', padding: 2 }}>Expect</th>
                        <th style={{ textAlign: 'right', padding: 2 }}>PF</th>
                        <th style={{ textAlign: 'right', padding: 2 }}>Trades</th>
                        <th style={{ padding: 2 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {optResults.results.map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${COLORS.bgInput}` }}>
                          <td style={{ padding: 2, color: COLORS.textSec }}>{i + 1}</td>
                          <td style={{
                            padding: 2, textAlign: 'right',
                            color: row.win_rate >= 50 ? COLORS.win : COLORS.loss,
                          }}>{row.win_rate.toFixed(1)}</td>
                          <td style={{
                            padding: 2, textAlign: 'right',
                            color: row.total_pnl_r >= 0 ? COLORS.win : COLORS.loss,
                          }}>{row.total_pnl_r >= 0 ? '+' : ''}{row.total_pnl_r.toFixed(1)}</td>
                          <td style={{
                            padding: 2, textAlign: 'right',
                            color: row.expectancy >= 0 ? COLORS.win : COLORS.loss,
                          }}>{row.expectancy.toFixed(2)}</td>
                          <td style={{ padding: 2, textAlign: 'right', color: COLORS.text }}>
                            {row.profit_factor ? row.profit_factor.toFixed(2) : '-'}
                          </td>
                          <td style={{ padding: 2, textAlign: 'right', color: COLORS.textSec }}>
                            {row.total_closed || 0}
                          </td>
                          <td style={{ padding: 2 }}>
                            <button onClick={() => applyOptResult(row)} style={{
                              padding: '1px 6px', border: 'none', borderRadius: 2, cursor: 'pointer',
                              fontSize: 9, background: COLORS.accent, color: '#FFF',
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

          {/* ============================================ */}
          {/* Results: Metrics */}
          {/* ============================================ */}
          {stats && (
            <div style={{ marginTop: 4 }}>
              {/* 3 big cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div style={{ background: COLORS.bgCard, borderRadius: 4, padding: '8px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: COLORS.textSec }}>Win Rate</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: stats.win_rate >= 50 ? COLORS.win : COLORS.loss }}>
                    {stats.win_rate.toFixed(1)}%
                  </div>
                </div>
                <div style={{ background: COLORS.bgCard, borderRadius: 4, padding: '8px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: COLORS.textSec }}>PnL (R)</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: stats.total_pnl_r >= 0 ? COLORS.win : COLORS.loss }}>
                    {stats.total_pnl_r >= 0 ? '+' : ''}{stats.total_pnl_r.toFixed(1)}
                  </div>
                </div>
                <div style={{ background: COLORS.bgCard, borderRadius: 4, padding: '8px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: COLORS.textSec }}>Expectancy</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: stats.expectancy >= 0 ? COLORS.win : COLORS.loss }}>
                    {stats.expectancy.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Metrics table */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', fontSize: 11, marginBottom: 8 }}>
                {[
                  ['Trades', `${stats.wins}W / ${stats.losses}L (${stats.total_closed} cerrados)`],
                  ['Profit Factor', stats.profit_factor ? stats.profit_factor.toFixed(2) : '-'],
                  ['Max Drawdown', stats.max_drawdown_r ? `${stats.max_drawdown_r.toFixed(1)}R` : '-'],
                  ['Avg Winner', stats.avg_winner ? `+${stats.avg_winner.toFixed(2)}R` : '-'],
                  ['Avg Loser', stats.avg_loser ? `${stats.avg_loser.toFixed(2)}R` : '-'],
                  ['Max Consec W', stats.max_consec_wins || '-'],
                  ['Max Consec L', stats.max_consec_losses || '-'],
                  ['Avg Bars Held', stats.avg_bars_held ? stats.avg_bars_held.toFixed(0) : '-'],
                ].map(([label, value], i) => (
                  <React.Fragment key={i}>
                    <span style={{ color: COLORS.textSec }}>{label}</span>
                    <span style={{ color: COLORS.text, textAlign: 'right' }}>{value}</span>
                  </React.Fragment>
                ))}
              </div>

              {/* Info line */}
              <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
                {result.candles_count?.toLocaleString()} velas | {result.levels_count || 0} niveles | {(result.elapsed_seconds || 0).toFixed(1)}s
              </div>

              {/* Trade list toggle */}
              <button onClick={() => setShowTradeList(!showTradeList)}
                style={{
                  padding: '6px 12px', border: `1px solid ${COLORS.border}`, borderRadius: 4,
                  cursor: 'pointer', fontSize: 11, background: 'transparent',
                  color: showTradeList ? COLORS.accent : COLORS.textSec,
                }}
              >{showTradeList ? 'Ocultar' : 'Ver'} trades ({trades.length})</button>
            </div>
          )}
        </div>

        {/* Right column: Trade list */}
        {showTradeList && trades.length > 0 && (
          <div style={{
            width: 270, flexShrink: 0, overflowY: 'auto',
            borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 }}>
              Trades ({trades.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ color: COLORS.textSec }}>
                  <th style={{ textAlign: 'left', padding: '3px 2px' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '3px 2px' }}>Fecha</th>
                  <th style={{ padding: '3px 2px' }}>Dir</th>
                  <th style={{ textAlign: 'right', padding: '3px 2px' }}>Result</th>
                  <th style={{ textAlign: 'right', padding: '3px 2px' }}>PnL</th>
                  <th style={{ textAlign: 'right', padding: '3px 2px' }}>Acum</th>
                  <th style={{ textAlign: 'right', padding: '3px 2px' }}>Bars</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((z, i) => {
                  const isW = z.trade_result === 'WIN';
                  const isO = z.trade_result === 'OPEN';
                  const pnl = z.trade_pnl_r || 0;
                  const cumPnl = trades.slice(0, i + 1).reduce((s, t) => s + (t.trade_pnl_r || 0), 0);

                  return (
                    <tr key={i}
                      onClick={() => handleTradeClick(z)}
                      style={{ cursor: 'pointer', borderBottom: `1px solid ${COLORS.bgInput}` }}
                      onMouseEnter={(e) => e.currentTarget.style.background = COLORS.bgCard}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '3px 2px', color: COLORS.textSec }}>{i + 1}</td>
                      <td style={{ padding: '3px 2px', color: COLORS.text, fontSize: 9 }}>
                        {z.entry_timestamp ? new Date(z.entry_timestamp).toLocaleDateString() : '-'}
                      </td>
                      <td style={{
                        padding: '3px 2px', textAlign: 'center', fontWeight: 'bold',
                        color: z.direction === 'LONG' ? COLORS.win : COLORS.loss,
                      }}>
                        {z.direction === 'LONG' ? 'L' : 'S'}
                      </td>
                      <td style={{
                        padding: '3px 2px', textAlign: 'right', fontWeight: 'bold',
                        color: isO ? COLORS.open : isW ? COLORS.win : COLORS.loss,
                      }}>
                        {z.trade_result || '-'}
                      </td>
                      <td style={{
                        padding: '3px 2px', textAlign: 'right', fontFamily: 'monospace',
                        color: pnl >= 0 ? COLORS.win : COLORS.loss,
                      }}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}
                      </td>
                      <td style={{
                        padding: '3px 2px', textAlign: 'right', fontFamily: 'monospace',
                        color: cumPnl >= 0 ? COLORS.win : COLORS.loss,
                      }}>
                        {cumPnl >= 0 ? '+' : ''}{cumPnl.toFixed(1)}
                      </td>
                      <td style={{ padding: '3px 2px', textAlign: 'right', color: COLORS.textSec }}>
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
    </div>
  );
};

export default StrategyBuilder;
