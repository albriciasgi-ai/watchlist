// StrategyBuilder.jsx
// Modal para construir estrategias modulares de backtesting
// 5 bloques: Niveles, Senal de Entrada, Filtros, Riesgo, Exit Rules

import React, { useState, useCallback, useEffect, useRef } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';
import { API_BASE_URL } from '../config';

// =========================================================================
// Constantes de configuracion
// =========================================================================

const MAX_DAYS_BY_INTERVAL = {
  '1': 400, '3': 400, '5': 400, '15': 180, '30': 360,
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
      { key: 'use_poc', label: 'POC', type: 'toggle', default: true },
      { key: 'use_vah', label: 'VAH', type: 'toggle', default: true },
      { key: 'use_val', label: 'VAL', type: 'toggle', default: true },
      { key: 'lookback_segments', label: 'Segmentos activos', min: 0, max: 10, step: 1, default: 1 },
    ],
  },
  {
    id: 'vp_zones', label: 'VP Zones',
    desc: 'Zonas D/P/b clasificadas (pesado)',
    params: [
      { key: 'window_size', label: 'Window Size', min: 10, max: 100, step: 5, default: 30 },
      { key: 'window_step', label: 'Window Step', min: 1, max: 20, step: 1, default: 5 },
      { key: 'bins', label: 'Bins', min: 20, max: 100, step: 5, default: 50 },
      { key: 'va_percent', label: 'VA %', min: 0.50, max: 0.90, step: 0.05, default: 0.70 },
      { key: 'min_d_score', label: 'Min D-Score', min: 0, max: 80, step: 5, default: 40 },
      { key: 'include_pb_shapes', label: 'Incluir P/b', type: 'toggle', default: true },
      { key: 'max_range_pct', label: 'Max Range %', min: 0.5, max: 5.0, step: 0.5, default: 2.0 },
      { key: 'detection_mode', label: 'Modo', type: 'select', options: ['fixed_window', 'progressive'], default: 'fixed_window' },
      { key: 'use_poc', label: 'POC', type: 'toggle', default: true },
      { key: 'use_vah', label: 'VAH', type: 'toggle', default: true },
      { key: 'use_val', label: 'VAL', type: 'toggle', default: true },
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
  // --- Order Flow Level Sources ---
  {
    id: 'of_poc_cluster', label: 'OF POC Cluster',
    desc: 'POC persistente entre footprints consecutivos',
    params: [
      { key: 'period', label: 'Period', min: 10, max: 100, step: 5, default: 20 },
      { key: 'min_persistence', label: 'Min Persistencia', min: 2, max: 15, step: 1, default: 5 },
      { key: 'cluster_pct', label: 'Cluster %', min: 0.05, max: 1.0, step: 0.05, default: 0.15 },
      { key: 'step_size', label: 'Step Size (0=auto)', min: 0, max: 100, step: 0.1, default: 0 },
    ],
  },
  {
    id: 'of_imbalance_zones', label: 'OF Imbalance Zones',
    desc: 'Zonas con desequilibrio compra/venta acumulado',
    params: [
      { key: 'period', label: 'Period', min: 10, max: 100, step: 5, default: 20 },
      { key: 'imbalance_threshold', label: 'Imbalance Threshold', min: 1.5, max: 5.0, step: 0.25, default: 2.5 },
      { key: 'min_imbalances', label: 'Min Imbalances', min: 2, max: 10, step: 1, default: 3 },
      { key: 'step_size', label: 'Step Size (0=auto)', min: 0, max: 100, step: 0.1, default: 0 },
    ],
  },
  {
    id: 'of_high_volume_node', label: 'OF High Vol Node',
    desc: 'Niveles con volumen anomalamente alto',
    params: [
      { key: 'period', label: 'Period', min: 10, max: 100, step: 5, default: 30 },
      { key: 'min_zscore', label: 'Min Z-Score', min: 0.5, max: 4.0, step: 0.25, default: 1.5 },
      { key: 'top_n', label: 'Top N por seg.', min: 1, max: 10, step: 1, default: 3 },
      { key: 'step_size', label: 'Step Size (0=auto)', min: 0, max: 100, step: 0.1, default: 0 },
    ],
  },
  {
    id: 'of_abandoned_va', label: 'OF Abandoned VA',
    desc: 'Value Area no revisitada por barra siguiente (zona virgen)',
    params: [
      { key: 'period', label: 'Period', min: 10, max: 100, step: 5, default: 20 },
      { key: 'va_pct', label: 'VA %', min: 0.50, max: 0.90, step: 0.05, default: 0.70 },
      { key: 'min_abandoned', label: 'Min Abandonadas', min: 1, max: 5, step: 1, default: 1 },
      { key: 'step_size', label: 'Step Size (0=auto)', min: 0, max: 100, step: 0.1, default: 0 },
    ],
  },
  {
    id: 'of_aligned_poc', label: 'OF Aligned POC',
    desc: 'POC de N barras consecutivas al mismo precio',
    params: [
      { key: 'period', label: 'Period', min: 10, max: 100, step: 5, default: 20 },
      { key: 'min_aligned', label: 'Min Alineados', min: 2, max: 10, step: 1, default: 3 },
      { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.01, max: 0.50, step: 0.01, default: 0.10 },
      { key: 'step_size', label: 'Step Size (0=auto)', min: 0, max: 100, step: 0.1, default: 0 },
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
  // --- Order Flow Entry Signals ---
  { id: 'of_absorption', label: 'OF Absorption', desc: 'Absorcion de presion contraria en nivel', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 20, step: 1, default: 5 },
    { key: 'min_delta_ratio', label: 'Min Delta Ratio', min: 1.0, max: 5.0, step: 0.25, default: 2.0 },
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.2 },
  ]},
  { id: 'of_stacked_trigger', label: 'OF Stacked Trigger', desc: 'N deltas consecutivos en misma direccion', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 15, step: 1, default: 3 },
    { key: 'min_consecutive', label: 'Min Consecutivos', min: 2, max: 10, step: 1, default: 3 },
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.2 },
  ]},
  { id: 'of_delta_divergence', label: 'OF Delta Divergence', desc: 'Divergencia precio vs delta footprint', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 30, step: 1, default: 10 },
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.3 },
  ]},
  { id: 'of_delta_tail', label: 'OF Delta Tail', desc: 'Absorcion en extremos de la barra (cola de delta)', params: [
    { key: 'min_tail_ratio', label: 'Min Tail Ratio', min: 0.2, max: 2.0, step: 0.1, default: 0.6 },
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.3 },
  ]},
  { id: 'of_exhaustion', label: 'OF Exhaustion', desc: 'Volumen muy bajo en extremos = agotamiento', params: [
    { key: 'max_extreme_vol_pct', label: 'Max Extreme Vol %', min: 1.0, max: 30.0, step: 1.0, default: 10.0 },
    { key: 'n_extreme_levels', label: 'N Extreme Levels', min: 1, max: 10, step: 1, default: 3 },
    { key: 'tolerance_pct', label: 'Tolerancia %', min: 0.05, max: 1.0, step: 0.05, default: 0.3 },
  ]},
];

// --- Catalogo de Context Filters ---
const CONTEXT_FILTERS = [
  { id: 'vwap_trend', label: 'VWAP Trend', desc: 'VWAP subiendo=solo LONG, bajando=solo SHORT', params: [
    { key: 'lookback', label: 'Lookback', min: 5, max: 1000, step: 5, default: 10 },
    { key: 'min_diff_pct', label: 'Min Diff %', min: 0, max: 2.0, step: 0.05, default: 0 },
  ]},
  { id: 'vwap_position', label: 'VWAP Position', desc: 'Posicion del precio respecto a VWAP/bandas', params: [
    { key: 'mode', label: 'Modo', type: 'select', options: ['trend', 'counter'], default: 'trend' },
    { key: 'long_ref', label: 'Ref LONG', type: 'select', options: ['vwap', 'upper_1', 'upper_2', 'upper_3', 'lower_1', 'lower_2', 'lower_3'], default: 'vwap' },
    { key: 'short_ref', label: 'Ref SHORT', type: 'select', options: ['vwap', 'upper_1', 'upper_2', 'upper_3', 'lower_1', 'lower_2', 'lower_3'], default: 'vwap' },
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
  { id: 'vp_shape', label: 'VP Shape Filter', desc: 'Filtrar por forma del perfil VP (D, P, b, thin)', params: [
    { key: 'allowed_shapes', label: 'Shapes permitidos', type: 'multi_select',
      options: ['all', 'D', 'P', 'b', 'P_trimmed', 'b_trimmed', 'thin'], default: ['all'] },
  ]},
  // --- Order Flow Context Filters ---
  { id: 'of_delta_bias', label: 'OF Delta Bias', desc: 'Sesgo delta acumulado: ask>bid=LONG, bid>ask=SHORT', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 50, step: 1, default: 10 },
    { key: 'min_ratio', label: 'Min Ratio', min: 0.5, max: 0.9, step: 0.05, default: 0.55 },
  ]},
  { id: 'of_poc_position', label: 'OF POC Position', desc: 'Precio vs POC reciente: arriba=LONG, abajo=SHORT', params: [
    { key: 'lookback', label: 'Lookback', min: 5, max: 100, step: 5, default: 20 },
    { key: 'mode', label: 'Modo', type: 'select', options: ['trend', 'counter'], default: 'trend' },
  ]},
  { id: 'of_accumulation', label: 'OF Accumulation', desc: 'Acumulacion (bid dominante) / Distribucion (ask dominante)', params: [
    { key: 'lookback', label: 'Lookback', min: 3, max: 30, step: 1, default: 10 },
    { key: 'min_ratio', label: 'Min Ratio', min: 0.50, max: 0.80, step: 0.05, default: 0.55 },
  ]},
  { id: 'of_delta_volume_ratio', label: 'OF Delta/Vol Ratio', desc: 'Ratio delta/volumen como medida de conviccion', params: [
    { key: 'min_ratio', label: 'Min Ratio', min: 0.05, max: 0.60, step: 0.05, default: 0.25 },
    { key: 'lookback', label: 'Lookback', min: 1, max: 20, step: 1, default: 5 },
  ]},
  { id: 'of_extreme_delta', label: 'OF Extreme Delta', desc: 'Delta en percentil extremo (top/bottom)', params: [
    { key: 'percentile', label: 'Percentile', min: 80, max: 99, step: 1, default: 95 },
    { key: 'lookback', label: 'Lookback', min: 10, max: 100, step: 5, default: 50 },
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
  accent: '#00897B',    // Verde teal - branding del Strategy Builder (OrderFlow)
  accentLight: '#80CBC4',
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
      cooldown_bars: state.cooldownBars || 0,
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
  const [cooldownBars, setCooldownBars] = useState(0);
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
  const [showDebugHash, setShowDebugHash] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState({ levels: true });

  // Preset state
  const [presets, setPresets] = useState({});
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetLoading, setPresetLoading] = useState(false);

  // VP Zone Cache state
  const [vpZoneCaches, setVpZoneCaches] = useState([]);
  const [vpCacheLoading, setVpCacheLoading] = useState(false);

  // Optimizer state
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optParamRanges, setOptParamRanges] = useState({});
  const [optMetric, setOptMetric] = useState('expectancy');
  const [optEstimate, setOptEstimate] = useState(null);
  const [optResults, setOptResults] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState(null);

  // Auto-optimize state
  const [showAutoOpt, setShowAutoOpt] = useState(false);
  const [autoOptLoading, setAutoOptLoading] = useState(false);
  const [autoOptProgress, setAutoOptProgress] = useState(null);
  const [autoOptResults, setAutoOptResults] = useState(null);
  const [autoOptError, setAutoOptError] = useState(null);
  const [autoOptMetric, setAutoOptMetric] = useState('recovery_factor');
  const [autoOptMinTrades, setAutoOptMinTrades] = useState(15);
  const [autoOptShowAll, setAutoOptShowAll] = useState(false);
  const [autoOptSortCol, setAutoOptSortCol] = useState(null);
  const [autoOptSortAsc, setAutoOptSortAsc] = useState(false);

  // Realtime state
  const [showRealtime, setShowRealtime] = useState(false);
  const [rtStatus, setRtStatus] = useState(null);
  const [rtLoading, setRtLoading] = useState(false);
  const rtPollRef = useRef(null);

  const abortRef = useRef(null);

  // Update days when interval changes
  useEffect(() => {
    setDays(DEFAULT_DAYS[interval] || 90);
  }, [interval]);

  // Cargar presets del backend al montar
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE_URL}/api/strategy-builder/presets`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.presets) setPresets(data.presets);
      })
      .catch(() => {});
  }, [isOpen]);

  const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 365;

  // Cargar caches VP cuando se activa vp_zones
  useEffect(() => {
    if (!isOpen || !levelSources.vp_zones) {
      setVpZoneCaches([]);
      return;
    }
    setVpCacheLoading(true);
    fetch(`${API_BASE_URL}/api/strategy-builder/vp-zone-caches?symbol=${symbol}&interval=${interval}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setVpZoneCaches(data.caches || []);
      })
      .catch(() => {})
      .finally(() => setVpCacheLoading(false));
  }, [isOpen, levelSources.vp_zones, symbol, interval]);

  // --- Preset helpers ---

  const collectCurrentState = useCallback(() => {
    return {
      levelSources, levelParams, entrySignalType, entrySignalParams,
      contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
      maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
      confluenceMode, minConfluenceScore, vwapPeriod, days,
    };
  }, [
    levelSources, levelParams, entrySignalType, entrySignalParams,
    contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
    maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
    confluenceMode, minConfluenceScore, vwapPeriod, days,
  ]);

  const applyPresetState = useCallback((state) => {
    if (state.levelSources) setLevelSources(state.levelSources);
    if (state.levelParams) setLevelParams(state.levelParams);
    if (state.entrySignalType) setEntrySignalType(state.entrySignalType);
    if (state.entrySignalParams) setEntrySignalParams(state.entrySignalParams);
    if (state.contextFilters) setContextFilters(state.contextFilters);
    if (state.filterParams) setFilterParams(state.filterParams);
    if (state.slMethod) setSlMethod(state.slMethod);
    if (state.slParams) setSlParams(state.slParams);
    if (state.tpMethod) setTpMethod(state.tpMethod);
    if (state.tpParams) setTpParams(state.tpParams);
    if (state.maxTradesPerSegment != null) setMaxTradesPerSegment(state.maxTradesPerSegment);
    if (state.cooldownBars != null) setCooldownBars(state.cooldownBars);
    if (state.trailingStop != null) setTrailingStop(state.trailingStop);
    if (state.exitRules) setExitRules(state.exitRules);
    if (state.exitRuleParams) setExitRuleParams(state.exitRuleParams);
    if (state.confluenceMode) setConfluenceMode(state.confluenceMode);
    if (state.minConfluenceScore != null) setMinConfluenceScore(state.minConfluenceScore);
    if (state.vwapPeriod != null) setVwapPeriod(state.vwapPeriod);
    if (state.days != null) setDays(state.days);
  }, []);

  const handleSavePreset = useCallback(async () => {
    if (!presetName.trim()) return;
    setPresetLoading(true);
    try {
      const state = collectCurrentState();
      const config = buildConfigPayload(state);
      const res = await fetch(`${API_BASE_URL}/api/strategy-builder/presets/${encodeURIComponent(presetName.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: state,
          days: state.days,
          vwapPeriod: state.vwapPeriod,
          savedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Recargar presets
        const list = await fetch(`${API_BASE_URL}/api/strategy-builder/presets`).then(r => r.json());
        if (list.success) setPresets(list.presets);
        setSelectedPreset(presetName.trim());
        setPresetName('');
      }
    } catch (e) {
      console.error('[Presets] Error guardando:', e);
    } finally {
      setPresetLoading(false);
    }
  }, [presetName, collectCurrentState]);

  const handleLoadPreset = useCallback((name) => {
    const preset = presets[name];
    if (!preset || !preset.config) return;
    applyPresetState(preset.config);
    setSelectedPreset(name);
  }, [presets, applyPresetState]);

  const handleDeletePreset = useCallback(async (name) => {
    setPresetLoading(true);
    try {
      await fetch(`${API_BASE_URL}/api/strategy-builder/presets/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const list = await fetch(`${API_BASE_URL}/api/strategy-builder/presets`).then(r => r.json());
      if (list.success) setPresets(list.presets);
      if (selectedPreset === name) setSelectedPreset('');
    } catch (e) {
      console.error('[Presets] Error eliminando:', e);
    } finally {
      setPresetLoading(false);
    }
  }, [selectedPreset]);

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
      maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
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
    tpMethod, tpParams, maxTradesPerSegment, cooldownBars, trailingStop, exitRules,
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

  // --- Realtime handlers ---

  const fetchRtStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/strategy-builder/realtime/status`);
      const data = await res.json();
      if (data.success) setRtStatus(data);
    } catch (e) {
      // silently fail
    }
  }, []);

  // Fetch status when realtime panel is shown
  useEffect(() => {
    if (!isOpen || !showRealtime) {
      if (rtPollRef.current) { clearInterval(rtPollRef.current); rtPollRef.current = null; }
      return;
    }
    fetchRtStatus();
    rtPollRef.current = setInterval(fetchRtStatus, 5000);
    return () => { if (rtPollRef.current) { clearInterval(rtPollRef.current); rtPollRef.current = null; } };
  }, [isOpen, showRealtime, fetchRtStatus]);

  const handleToggleRealtime = useCallback(async () => {
    const isCurrentlyRunning = rtStatus && rtStatus.running;
    setRtLoading(true);

    try {
      const body = { enabled: !isCurrentlyRunning };

      if (!isCurrentlyRunning) {
        // Activar: enviar la estrategia actual y el simbolo
        const config = buildConfigPayload({
          levelSources, levelParams, entrySignalType, entrySignalParams,
          contextFilters, filterParams, slMethod, slParams, tpMethod, tpParams,
          maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
          confluenceMode, minConfluenceScore, vwapPeriod,
        });
        body.strategy = config;
        body.symbols = [symbol];
        body.interval = interval;
      }

      const res = await fetch(`${API_BASE_URL}/api/strategy-builder/realtime/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        await fetchRtStatus();
      }
    } catch (e) {
      console.error('[StrategyBuilder] Error toggling realtime:', e);
    } finally {
      setRtLoading(false);
    }
  }, [
    rtStatus, symbol, interval, levelSources, levelParams,
    entrySignalType, entrySignalParams, contextFilters, filterParams,
    slMethod, slParams, tpMethod, tpParams, maxTradesPerSegment,
    trailingStop, exitRules, exitRuleParams, confluenceMode,
    minConfluenceScore, vwapPeriod, fetchRtStatus,
  ]);

  const handleClearRtCooldowns = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/strategy-builder/realtime/clear-cooldowns`, { method: 'POST' });
      await fetchRtStatus();
    } catch (e) { /* silent */ }
  }, [fetchRtStatus]);

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
      maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
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
    slMethod, slParams, tpMethod, tpParams, maxTradesPerSegment, cooldownBars,
    trailingStop, exitRules, exitRuleParams, confluenceMode, minConfluenceScore, vwapPeriod,
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
      maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
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
    maxTradesPerSegment, cooldownBars, trailingStop, exitRules, exitRuleParams,
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

  // --- Auto-optimize handlers ---

  const handleRunAutoOptimize = useCallback(async () => {
    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
    if (!manager) { setAutoOptError('IndicatorManager no disponible'); return; }

    setAutoOptLoading(true);
    setAutoOptError(null);
    setAutoOptResults(null);
    setAutoOptShowAll(false);
    setAutoOptSortCol(null);
    setAutoOptProgress({ phase: 'connecting', percent: 0, message: 'Conectando...' });

    try {
      await manager.autoOptimizeStrategy({
        days: parseInt(days) || 365,
        interval,
        ranking_metric: autoOptMetric,
        min_trades: autoOptMinTrades,
        top_n: 20,
        onProgress: (p) => setAutoOptProgress(p),
        onComplete: (data) => {
          setAutoOptResults(data);
          setAutoOptLoading(false);
          setAutoOptProgress(null);
        },
        onError: (msg) => {
          setAutoOptError(msg);
          setAutoOptLoading(false);
          setAutoOptProgress(null);
        },
      });
    } catch (e) {
      setAutoOptError(e.message || 'Error de conexion');
      setAutoOptLoading(false);
      setAutoOptProgress(null);
    }
  }, [indicatorManager, symbol, interval, days, autoOptMetric, autoOptMinTrades]);

  const applyAutoOptResult = useCallback((row) => {
    const cfg = row.config;
    if (!cfg) return;

    // Level sources: desactivar todas, luego activar las del config
    const newLevelSources = {};
    const newLevelParams = {};
    for (const ls of LEVEL_SOURCES) {
      newLevelSources[ls.id] = false;
      // Mantener defaults
      const d = {};
      for (const p of (ls.params || [])) d[p.key] = p.default;
      newLevelParams[ls.id] = d;
    }
    for (const src of (cfg.level_sources || [])) {
      if (src.enabled !== false) {
        newLevelSources[src.source] = true;
        if (src.params) newLevelParams[src.source] = { ...(newLevelParams[src.source] || {}), ...src.params };
      }
    }
    setLevelSources(newLevelSources);
    setLevelParams(newLevelParams);

    // Entry signal
    if (cfg.entry_signal) {
      setEntrySignalType(cfg.entry_signal.signal_type || 'price_touch');
      if (cfg.entry_signal.params) setEntrySignalParams(cfg.entry_signal.params);
    }

    // Context filters: desactivar todas, luego activar las del config
    const newCtxFilters = {};
    const newFilterParams = {};
    for (const cf of CONTEXT_FILTERS) {
      newCtxFilters[cf.id] = false;
      const d = {};
      for (const p of (cf.params || [])) d[p.key] = p.default;
      newFilterParams[cf.id] = d;
    }
    // direction siempre activo
    newCtxFilters['direction'] = true;
    newFilterParams['direction'] = { allowed: 'both' };
    for (const f of (cfg.context_filters || [])) {
      if (f.enabled !== false) {
        newCtxFilters[f.filter_type] = true;
        if (f.params) newFilterParams[f.filter_type] = { ...(newFilterParams[f.filter_type] || {}), ...f.params };
      }
    }
    setContextFilters(newCtxFilters);
    setFilterParams(newFilterParams);

    // Risk management
    if (cfg.risk) {
      if (cfg.risk.sl_method) setSlMethod(cfg.risk.sl_method);
      if (cfg.risk.sl_params) setSlParams(cfg.risk.sl_params);
      if (cfg.risk.tp_method) setTpMethod(cfg.risk.tp_method);
      if (cfg.risk.tp_params) setTpParams(cfg.risk.tp_params);
      if (cfg.risk.max_trades_per_segment != null) setMaxTradesPerSegment(cfg.risk.max_trades_per_segment);
      if (cfg.risk.cooldown_bars != null) setCooldownBars(cfg.risk.cooldown_bars);
      if (cfg.risk.trailing_stop != null) setTrailingStop(cfg.risk.trailing_stop);
    }

    // Exit rules: desactivar todas, luego activar las del config
    const newExitRules = {};
    const newExitParams = {};
    for (const er of EXIT_RULES) {
      newExitRules[er.id] = false;
      const d = {};
      for (const p of (er.params || [])) d[p.key] = p.default;
      newExitParams[er.id] = d;
    }
    for (const r of (cfg.exit_rules || [])) {
      if (r.enabled !== false) {
        newExitRules[r.rule_type] = true;
        if (r.params) newExitParams[r.rule_type] = { ...(newExitParams[r.rule_type] || {}), ...r.params };
      }
    }
    setExitRules(newExitRules);
    setExitRuleParams(newExitParams);

    // Globals
    if (cfg.confluence_mode) setConfluenceMode(cfg.confluence_mode);
    if (cfg.min_confluence_score != null) setMinConfluenceScore(cfg.min_confluence_score);
    if (cfg.vwap_period != null) setVwapPeriod(cfg.vwap_period);
  }, []);

  const handleAutoOptExport = useCallback(() => {
    if (!autoOptResults || !autoOptResults.results) return;

    const headers = ['Rank', 'Levels', 'Entry', 'SL', 'TP', 'Exits', 'Filters',
      'Score', 'WR%', 'Trades', 'W', 'L', 'PnL(R)', 'Expect', 'PF', 'MaxDD', 'RecFactor', 'AvgBars'];
    const allHeaders = ['Phase', ...headers];

    const escXml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const rowToValues = (r) => [
      r.rank || 0,
      (r.levels || []).join('+'),
      r.entry || '',
      r.sl || '',
      r.tp || '',
      (r.exits || []).join('+') || '-',
      (r.filters || []).join('+') || '-',
      r.score || 0,
      r.win_rate || 0,
      r.closed || 0,
      r.wins || 0,
      r.losses || 0,
      r.total_pnl_r || 0,
      r.expectancy || 0,
      r.profit_factor || 0,
      r.max_drawdown_r || 0,
      r.recovery_factor || 0,
      r.avg_bars_held || 0,
    ];

    const buildCell = (val) => {
      if (typeof val === 'number') {
        return `<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
      }
      return `<Cell><Data ss:Type="String">${escXml(val)}</Data></Cell>`;
    };

    const buildSheet = (name, hdrs, rows) => {
      let xml = `<Worksheet ss:Name="${escXml(name)}"><Table>`;
      // Header row
      xml += '<Row>';
      for (const h of hdrs) xml += `<Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>`;
      xml += '</Row>';
      // Data rows
      for (const vals of rows) {
        xml += '<Row>';
        for (const v of vals) xml += buildCell(v);
        xml += '</Row>';
      }
      xml += '</Table></Worksheet>';
      return xml;
    };

    // Sheet 1: Top Results
    const topRows = autoOptResults.results.map(r => rowToValues(r));

    // Sheet 2: All Combinations
    const allRows = (autoOptResults.all_results || []).map(r => [r.phase || '', ...rowToValues(r)]);

    let xls = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xls += '<?mso-application progid="Excel.Sheet"?>\n';
    xls += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ';
    xls += 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
    xls += buildSheet(`Top ${autoOptResults.results.length}`, headers, topRows);
    if (allRows.length > 0) {
      xls += buildSheet('Todas las combinaciones', allHeaders, allRows);
    }
    xls += '</Workbook>';

    const blob = new Blob([xls], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto_optimize_${symbol}_${interval}_${days}d.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }, [autoOptResults, symbol, interval, days]);

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
  const trades = result?.zones || [];
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
    if (param.type === 'multi_select') {
      const selected = Array.isArray(value) ? value : [value || param.options[0]];
      return (
        <div key={param.key} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 2 }}>{param.label}</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {param.options.map(opt => {
              const isActive = selected.includes(opt);
              return (
                <button key={opt} onClick={() => {
                  if (opt === 'all') {
                    onChange(['all']);
                  } else {
                    let next = selected.filter(s => s !== 'all');
                    if (isActive) {
                      next = next.filter(s => s !== opt);
                      if (next.length === 0) next = ['all'];
                    } else {
                      next.push(opt);
                    }
                    onChange(next);
                  }
                }} style={{
                  padding: '2px 7px', border: 'none', borderRadius: 3, cursor: 'pointer',
                  fontSize: 10, fontWeight: isActive ? 'bold' : 'normal',
                  background: isActive ? COLORS.accent : COLORS.bgInput,
                  color: isActive ? '#FFF' : COLORS.textSec,
                }}>{opt}</button>
              );
            })}
          </div>
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

      {/* Presets bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
        background: COLORS.bgInput, borderBottom: `1px solid ${COLORS.border}`,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, color: COLORS.textSec, whiteSpace: 'nowrap' }}>Preset:</span>
        <select
          value={selectedPreset}
          onChange={(e) => {
            const name = e.target.value;
            if (name) handleLoadPreset(name);
            else setSelectedPreset('');
          }}
          style={{
            flex: 1, minWidth: 80, maxWidth: 160, padding: '3px 4px', fontSize: 11,
            background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
            color: COLORS.text, borderRadius: 3,
          }}
        >
          <option value="">-- ninguno --</option>
          {Object.keys(presets).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        {selectedPreset && (
          <button onClick={() => handleDeletePreset(selectedPreset)}
            disabled={presetLoading}
            title="Eliminar preset"
            style={{
              padding: '2px 6px', border: 'none', borderRadius: 3, cursor: 'pointer',
              fontSize: 11, background: COLORS.loss, color: '#FFF',
            }}
          >X</button>
        )}
        <span style={{ color: COLORS.border }}>|</span>
        <input
          type="text" placeholder="Nombre preset..."
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
          style={{
            flex: 1, minWidth: 80, maxWidth: 140, padding: '3px 6px', fontSize: 11,
            background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
            color: COLORS.text, borderRadius: 3,
          }}
        />
        <button onClick={handleSavePreset}
          disabled={presetLoading || !presetName.trim()}
          style={{
            padding: '3px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
            fontSize: 11, fontWeight: 'bold',
            background: presetName.trim() ? COLORS.accent : COLORS.bgCard,
            color: presetName.trim() ? '#FFF' : COLORS.textSec,
          }}
        >Guardar</button>
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
            <input type="range" min={5} max={6000} step={vwapPeriod < 200 ? 5 : 50} value={vwapPeriod}
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
                      {ls.params.map(p => renderParamControl(p,
                        (levelParams[ls.id] || {})[p.key] ?? p.default,
                        (val) => setLevelParams(prev => ({
                          ...prev, [ls.id]: { ...(prev[ls.id] || {}), [p.key]: val }
                        }))
                      ))}
                      {/* VP Zone Cache Panel */}
                      {ls.id === 'vp_zones' && (
                        <div style={{
                          marginTop: 8, padding: '6px 8px',
                          background: 'rgba(0,137,123,0.08)',
                          border: '1px solid rgba(0,137,123,0.25)',
                          borderRadius: 4, fontSize: 11,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 'bold', color: COLORS.text }}>
                              Cache de zonas VP
                            </span>
                            {vpCacheLoading && (
                              <span style={{ fontSize: 10, color: '#888' }}>cargando...</span>
                            )}
                          </div>
                          {vpZoneCaches.length === 0 && !vpCacheLoading && (
                            <div style={{ color: '#888', fontSize: 10, fontStyle: 'italic' }}>
                              Sin caches para {symbol} @ {interval}. Se escanearan al ejecutar el backtest.
                            </div>
                          )}
                          {vpZoneCaches.length > 0 && (
                            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                              {vpZoneCaches.map((c, ci) => {
                                const currentParams = levelParams.vp_zones || {};
                                const vpDef = LEVEL_SOURCES.find(l => l.id === 'vp_zones');
                                const keyParams = ['window_size', 'window_step', 'bins', 'va_percent',
                                  'min_d_score', 'include_pb_shapes', 'max_range_pct', 'detection_mode'];
                                const isMatch = keyParams.every(k => {
                                  const defVal = vpDef?.params.find(p => p.key === k)?.default;
                                  const uiVal = currentParams[k] ?? defVal;
                                  const cacheVal = (c.detection_params || {})[k];
                                  if (cacheVal === undefined || cacheVal === null) return true;
                                  return String(uiVal) === String(cacheVal);
                                });
                                const matchDays = c.days === days;
                                const isFull = isMatch && matchDays;
                                return (
                                  <div key={ci} style={{
                                    padding: '4px 6px', marginBottom: 3, borderRadius: 3,
                                    background: isFull ? 'rgba(0,200,100,0.12)' : 'rgba(255,255,255,0.04)',
                                    border: isFull ? '1px solid rgba(0,200,100,0.4)' : '1px solid rgba(255,255,255,0.08)',
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontWeight: 'bold', color: isFull ? '#4caf50' : COLORS.text, fontSize: 11 }}>
                                        {isFull ? '\u2705' : isMatch ? '\u26A0\uFE0F' : '\u274C'} {c.zones_count} zonas
                                        <span style={{ fontWeight: 'normal', color: '#888', marginLeft: 4, fontSize: 10 }}>
                                          ({c.days}d, {c.candles_count?.toLocaleString()} velas, {c.age_hours < 1 ? '<1h' : c.age_hours.toFixed(0) + 'h'})
                                        </span>
                                      </span>
                                      {!isFull && (
                                        <button
                                          onClick={() => {
                                            const dp = c.detection_params || {};
                                            const newParams = { ...(levelParams.vp_zones || {}) };
                                            keyParams.forEach(k => {
                                              if (dp[k] !== undefined && dp[k] !== null) {
                                                newParams[k] = dp[k];
                                              }
                                            });
                                            setLevelParams(prev => ({ ...prev, vp_zones: newParams }));
                                            if (c.days !== days) setDays(c.days);
                                          }}
                                          style={{
                                            padding: '2px 8px', border: 'none', borderRadius: 3,
                                            background: COLORS.accent, color: '#FFF',
                                            fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
                                          }}
                                        >
                                          Usar estos params
                                        </button>
                                      )}
                                    </div>
                                    {/* Detalle de params del cache */}
                                    <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 10, color: '#999' }}>
                                      {keyParams.map(k => {
                                        const cVal = (c.detection_params || {})[k];
                                        if (cVal === undefined || cVal === null) return null;
                                        const defVal = vpDef?.params.find(p => p.key === k)?.default;
                                        const uiVal = currentParams[k] ?? defVal;
                                        const match = String(uiVal) === String(cVal);
                                        const shortKey = k.replace('window_', 'w_').replace('include_', '').replace('detection_', '');
                                        return (
                                          <span key={k} style={{ color: match ? '#6a6' : '#e88' }}>
                                            {shortKey}={typeof cVal === 'boolean' ? (cVal ? 'on' : 'off') : cVal}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {vpZoneCaches.length > 0 && vpZoneCaches.every(c => {
                            const currentParams = levelParams.vp_zones || {};
                            const vpDef = LEVEL_SOURCES.find(l => l.id === 'vp_zones');
                            const keyParams = ['window_size', 'window_step', 'bins', 'va_percent',
                              'min_d_score', 'include_pb_shapes', 'max_range_pct', 'detection_mode'];
                            return !keyParams.every(k => {
                              const defVal = vpDef?.params.find(p => p.key === k)?.default;
                              const uiVal = currentParams[k] ?? defVal;
                              const cacheVal = (c.detection_params || {})[k];
                              if (cacheVal === undefined || cacheVal === null) return true;
                              return String(uiVal) === String(cacheVal);
                            }) || c.days !== days;
                          }) && (
                            <div style={{ marginTop: 4, fontSize: 10, color: '#e88', fontStyle: 'italic' }}>
                              Ningun cache coincide con los params actuales. Se escaneara al ejecutar.
                            </div>
                          )}
                        </div>
                      )}
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

              {/* Cooldown bars */}
              {renderSlider(
                { key: 'cdb', label: 'Cooldown (velas)', min: 0, max: 500, step: 5 },
                cooldownBars, setCooldownBars
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
            <button onClick={() => setShowAutoOpt(!showAutoOpt)} disabled={autoOptLoading}
              style={{
                padding: '10px 12px', border: '1px solid #00E676', borderRadius: 4,
                cursor: autoOptLoading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 'bold',
                background: showAutoOpt ? '#00E676' : 'transparent',
                color: showAutoOpt ? '#FFF' : '#00E676',
              }}
            >{autoOptLoading ? 'Buscando...' : 'Auto-Opt'}</button>
            <button onClick={() => { setShowRealtime(!showRealtime); if (!showRealtime) fetchRtStatus(); }}
              style={{
                padding: '10px 12px', border: `1px solid ${rtStatus && rtStatus.running ? '#4CAF50' : '#FF9800'}`,
                borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
                background: showRealtime ? (rtStatus && rtStatus.running ? '#4CAF50' : '#FF9800') : 'transparent',
                color: showRealtime ? '#FFF' : (rtStatus && rtStatus.running ? '#4CAF50' : '#FF9800'),
              }}
            >{rtStatus && rtStatus.running ? 'RT ON' : 'Realtime'}</button>
            {result && (
              <button onClick={handleClearZones} title="Limpiar zonas del chart"
                style={{
                  padding: '10px 12px', border: `1px solid ${COLORS.border}`, borderRadius: 4,
                  cursor: 'pointer', fontSize: 12, background: 'transparent', color: COLORS.textSec,
                }}
              >Limpiar</button>
            )}
          </div>

          {/* Debug hash checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
            color: COLORS.textSec, cursor: 'pointer', userSelect: 'none', marginBottom: 4 }}>
            <input type="checkbox" checked={showDebugHash}
              onChange={e => setShowDebugHash(e.target.checked)}
              style={{ width: 12, height: 12, cursor: 'pointer' }} />
            Mostrar hash de determinismo
          </label>

          {/* Progress bar */}
          {progress && (
            <div style={{
              padding: '10px 12px', background: COLORS.bgCard, borderRadius: 6,
              marginBottom: 10, border: `1px solid ${COLORS.border}`,
            }}>
              {/* Barra visual */}
              <div style={{
                width: '100%', height: 22, background: 'rgba(0,0,0,0.3)',
                borderRadius: 11, overflow: 'hidden', position: 'relative',
                marginBottom: 6,
              }}>
                <div style={{
                  width: `${Math.max(progress.percent || 0, 2)}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.accentLight})`,
                  borderRadius: 11,
                  transition: 'width 0.4s ease',
                }} />
                <span style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontSize: 11, fontWeight: 'bold', color: '#FFF',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {progress.percent || 0}%
                </span>
              </div>
              {/* Fase actual */}
              <div style={{ fontSize: 11, color: COLORS.textSec, textAlign: 'center' }}>
                {progress.message || 'Procesando...'}
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
                  min: 5, max: 6000, step: 50, default: 20,
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
          {/* Auto-Optimize Section */}
          {/* ============================================ */}
          {showAutoOpt && (
            <div style={{
              padding: '10px', background: COLORS.bgInput, borderRadius: 6,
              border: '1px solid #00E67640', marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: '#00E676', marginBottom: 8 }}>
                Auto-Optimizador (3 fases)
              </div>
              <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 8 }}>
                Busca automaticamente la mejor combinacion de niveles, senal, SL, TP,
                filtros y exit rules. Luego afina parametros numericos.
                Usa {days} dias en {interval}min.
              </div>

              {/* Metric selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: COLORS.textSec }}>Metrica de ranking:</span>
                <select value={autoOptMetric} onChange={e => setAutoOptMetric(e.target.value)}
                  disabled={autoOptLoading}
                  style={{
                    flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 4,
                    background: COLORS.bgCard, color: COLORS.text, border: `1px solid ${COLORS.border}`,
                  }}>
                  <option value="recovery_factor">Recovery Factor (PnL/MaxDD)</option>
                  <option value="total_pnl_r">PnL Total (R)</option>
                  <option value="expectancy">Expectancy (R/trade)</option>
                  <option value="profit_factor">Profit Factor</option>
                  <option value="win_rate">Win Rate %</option>
                  <option value="max_drawdown_r">Max Drawdown (menor=mejor)</option>
                </select>
              </div>

              {/* Min trades slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: COLORS.textSec, whiteSpace: 'nowrap' }}>Min trades:</span>
                <input type="range" min={5} max={50} step={5} value={autoOptMinTrades}
                  onChange={e => setAutoOptMinTrades(parseInt(e.target.value))}
                  disabled={autoOptLoading}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, color: COLORS.text, minWidth: 20, textAlign: 'right' }}>{autoOptMinTrades}</span>
                <span style={{ fontSize: 10, color: COLORS.textSec }}>
                  (penaliza &lt;{autoOptMinTrades} trades)
                </span>
              </div>

              {/* Boton ejecutar */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button onClick={handleRunAutoOptimize} disabled={autoOptLoading}
                  style={{
                    flex: 1, padding: '8px 0', border: 'none', borderRadius: 4,
                    cursor: autoOptLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: 12,
                    background: autoOptLoading ? COLORS.bgCard : '#00E676',
                    color: '#FFF',
                  }}
                >{autoOptLoading ? 'Buscando...' : 'Iniciar Auto-Optimizacion'}</button>
                {autoOptLoading && (
                  <button onClick={() => {
                    const manager = indicatorManager || IndicatorManagerRegistry.get(symbol);
                    if (manager) manager.cancelAutoOptimize();
                    setAutoOptLoading(false);
                    setAutoOptProgress(null);
                  }}
                    style={{
                      padding: '8px 12px', border: '1px solid #FF5252', borderRadius: 4,
                      cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#FF5252',
                    }}
                  >Cancelar</button>
                )}
              </div>

              {/* Progress */}
              {autoOptProgress && (
                <div style={{
                  padding: '8px', background: COLORS.bgCard, borderRadius: 6,
                  marginBottom: 8, border: `1px solid ${COLORS.border}`,
                }}>
                  <div style={{
                    width: '100%', height: 20, background: 'rgba(0,0,0,0.3)',
                    borderRadius: 10, overflow: 'hidden', position: 'relative', marginBottom: 4,
                  }}>
                    <div style={{
                      width: `${Math.max(autoOptProgress.percent || 0, 2)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #00E676, #80CBC4)',
                      borderRadius: 10, transition: 'width 0.4s ease',
                    }} />
                    <span style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: 10, fontWeight: 'bold', color: '#FFF',
                      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    }}>{autoOptProgress.percent || 0}%</span>
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.textSec, textAlign: 'center' }}>
                    {autoOptProgress.message || 'Procesando...'}
                  </div>
                </div>
              )}

              {/* Error */}
              {autoOptError && (
                <div style={{
                  padding: '6px 8px', background: 'rgba(255,50,50,0.15)', border: '1px solid #FF5252',
                  borderRadius: 4, fontSize: 11, color: '#FF5252', marginBottom: 8,
                }}>{autoOptError}</div>
              )}

              {/* Results */}
              {autoOptResults && autoOptResults.results && (
                <div>
                  {/* Summary */}
                  <div style={{
                    display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 10, color: COLORS.textSec }}>
                      {autoOptResults.total_backtests} backtests
                    </span>
                    <span style={{ fontSize: 10, color: COLORS.textSec }}>
                      {autoOptResults.elapsed}s
                    </span>
                    <span style={{ fontSize: 10, color: COLORS.textSec }}>
                      {autoOptResults.candles_count || autoOptResults.candles} velas
                    </span>
                    <button onClick={handleAutoOptExport} style={{
                      padding: '2px 8px', border: `1px solid ${COLORS.accent}`, borderRadius: 3,
                      cursor: 'pointer', fontSize: 10, background: 'transparent', color: COLORS.accent,
                      marginLeft: 'auto',
                    }}>XLS</button>
                  </div>

                  {/* Phase 1 summary */}
                  {autoOptResults.phase1_summary && (
                    <details style={{ marginBottom: 8, fontSize: 10, color: COLORS.textSec }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#00E676' }}>
                        Fase 1: Ranking individual
                      </summary>
                      <div style={{ padding: '4px 0 4px 12px' }}>
                        {autoOptResults.phase1_summary.adaptive_base && (
                          <div style={{ marginBottom: 2, color: '#00E676' }}>
                            <b>Base adaptativa:</b> {autoOptResults.phase1_summary.adaptive_base}
                          </div>
                        )}
                        <div><b>Niveles:</b> {(autoOptResults.phase1_summary.best_levels || []).map(([k, s]) => `${k}(${s})`).join(', ')}</div>
                        <div><b>Senales:</b> {(autoOptResults.phase1_summary.best_entries || []).map(([k, s]) => `${k}(${s})`).join(', ')}</div>
                        <div><b>SL:</b> {(autoOptResults.phase1_summary.best_sls || []).map(([k, s]) => `${k}(${s})`).join(', ')}</div>
                        <div><b>TP:</b> {(autoOptResults.phase1_summary.best_tps || []).map(([k, s]) => `${k}(${s})`).join(', ')}</div>
                        <div><b>Exits utiles:</b> {(autoOptResults.phase1_summary.beneficial_exits || []).join(', ') || 'ninguno'}</div>
                        <div><b>Filtros utiles:</b> {(autoOptResults.phase1_summary.beneficial_filters || []).join(', ') || 'ninguno'}</div>
                        {autoOptResults.phase1_summary.diversity_pool && (
                          <div style={{ marginTop: 2, color: '#80CBC4' }}>
                            <b>Diversity pool:</b>{' '}
                            {[...(autoOptResults.phase1_summary.diversity_pool.levels_added || []),
                              ...(autoOptResults.phase1_summary.diversity_pool.entries_added || [])].join(', ') || 'ninguno extra'}
                          </div>
                        )}
                        {autoOptResults.min_trades && (
                          <div style={{ marginTop: 2 }}>
                            <b>Min trades:</b> {autoOptResults.min_trades} (penalizacion cuadratica)
                          </div>
                        )}
                      </div>
                    </details>
                  )}

                  {/* Tab selector: Top N vs Todas */}
                  {(() => {
                    const topRows = autoOptResults.results || [];
                    const allRows = autoOptResults.all_results || [];
                    const baseRows = autoOptShowAll ? allRows : topRows;
                    const phaseLabels = { phase1_level: 'P1-Lvl', phase1_entry: 'P1-Ent', phase1_sl: 'P1-SL', phase1_tp: 'P1-TP', phase1_exit: 'P1-Exit', phase1_filter: 'P1-Filt', phase2: 'P2', phase3: 'P3' };
                    const phaseColors = { phase1_level: '#9E9E9E', phase1_entry: '#9E9E9E', phase1_sl: '#9E9E9E', phase1_tp: '#9E9E9E', phase1_exit: '#9E9E9E', phase1_filter: '#9E9E9E', phase2: '#FF9800', phase3: '#00E676' };

                    // Sortable columns: key -> accessor
                    const sortableCols = {
                      score: r => r.score || 0,
                      win_rate: r => r.win_rate || 0,
                      closed: r => r.closed || 0,
                      wins: r => r.wins || 0,
                      losses: r => r.losses || 0,
                      total_pnl_r: r => r.total_pnl_r || 0,
                      expectancy: r => r.expectancy || 0,
                      profit_factor: r => r.profit_factor || 0,
                      max_drawdown_r: r => r.max_drawdown_r || 0,
                      recovery_factor: r => r.recovery_factor || 0,
                      avg_bars_held: r => r.avg_bars_held || 0,
                    };

                    // Apply sort
                    let displayRows = baseRows;
                    if (autoOptSortCol && sortableCols[autoOptSortCol]) {
                      const accessor = sortableCols[autoOptSortCol];
                      displayRows = [...baseRows].sort((a, b) => {
                        const va = accessor(a), vb = accessor(b);
                        return autoOptSortAsc ? va - vb : vb - va;
                      });
                    }

                    const handleColSort = (colKey) => {
                      if (autoOptSortCol === colKey) {
                        setAutoOptSortAsc(!autoOptSortAsc);
                      } else {
                        setAutoOptSortCol(colKey);
                        setAutoOptSortAsc(false);
                      }
                    };

                    const sortArrow = (colKey) => {
                      if (autoOptSortCol !== colKey) return '';
                      return autoOptSortAsc ? ' \u25B2' : ' \u25BC';
                    };

                    const thSortStyle = (colKey, align = 'right') => ({
                      padding: '3px 4px', textAlign: align, cursor: 'pointer', userSelect: 'none',
                      color: autoOptSortCol === colKey ? '#00E676' : COLORS.textSec,
                    });

                    return (<>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        <button onClick={() => { setAutoOptShowAll(false); setAutoOptSortCol(null); }} style={{
                          padding: '3px 10px', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 10,
                          background: !autoOptShowAll ? '#00E676' : COLORS.bgInput, color: !autoOptShowAll ? '#FFF' : COLORS.textSec,
                        }}>Top {topRows.length}</button>
                        <button onClick={() => { setAutoOptShowAll(true); setAutoOptSortCol(null); }} style={{
                          padding: '3px 10px', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 10,
                          background: autoOptShowAll ? '#00E676' : COLORS.bgInput, color: autoOptShowAll ? '#FFF' : COLORS.textSec,
                        }}>Todas ({allRows.length})</button>
                        <span style={{ fontSize: 9, color: COLORS.textSec, marginLeft: 'auto' }}>
                          {autoOptSortCol
                            ? `Ordenado por ${autoOptSortCol} ${autoOptSortAsc ? 'ASC' : 'DESC'} - doble-click en columna para cambiar`
                            : 'Doble-click en columna para ordenar'}
                        </span>
                      </div>

                      <div style={{ overflowX: 'auto', maxHeight: 400 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${COLORS.border}`, position: 'sticky', top: 0, background: COLORS.bgInput, zIndex: 1 }}>
                              {autoOptShowAll && <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>Fase</th>}
                              <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>#</th>
                              <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>Niveles</th>
                              <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>Entrada</th>
                              <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>SL</th>
                              <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>TP</th>
                              {autoOptShowAll && <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>Exits</th>}
                              {autoOptShowAll && <th style={{ padding: '3px 4px', textAlign: 'left', color: COLORS.textSec }}>Filtros</th>}
                              <th style={thSortStyle('score')} onDoubleClick={() => handleColSort('score')}>Score{sortArrow('score')}</th>
                              <th style={thSortStyle('win_rate')} onDoubleClick={() => handleColSort('win_rate')}>WR%{sortArrow('win_rate')}</th>
                              <th style={thSortStyle('closed')} onDoubleClick={() => handleColSort('closed')}>Trades{sortArrow('closed')}</th>
                              <th style={thSortStyle('wins')} onDoubleClick={() => handleColSort('wins')}>W{sortArrow('wins')}</th>
                              <th style={thSortStyle('losses')} onDoubleClick={() => handleColSort('losses')}>L{sortArrow('losses')}</th>
                              <th style={thSortStyle('total_pnl_r')} onDoubleClick={() => handleColSort('total_pnl_r')}>PnL(R){sortArrow('total_pnl_r')}</th>
                              <th style={thSortStyle('expectancy')} onDoubleClick={() => handleColSort('expectancy')}>Expect{sortArrow('expectancy')}</th>
                              <th style={thSortStyle('profit_factor')} onDoubleClick={() => handleColSort('profit_factor')}>PF{sortArrow('profit_factor')}</th>
                              <th style={thSortStyle('max_drawdown_r')} onDoubleClick={() => handleColSort('max_drawdown_r')}>MaxDD{sortArrow('max_drawdown_r')}</th>
                              <th style={thSortStyle('recovery_factor')} onDoubleClick={() => handleColSort('recovery_factor')}>RecF{sortArrow('recovery_factor')}</th>
                              <th style={thSortStyle('avg_bars_held')} onDoubleClick={() => handleColSort('avg_bars_held')}>AvgBars{sortArrow('avg_bars_held')}</th>
                              <th style={{ padding: '3px 4px', textAlign: 'center', color: COLORS.textSec }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayRows.map((row, idx) => {
                              const isTop3 = !autoOptShowAll && !autoOptSortCol && idx < 3;
                              const isFirst = !autoOptShowAll && !autoOptSortCol && idx === 0;
                              const phase = row.phase || '';
                              return (
                                <tr key={idx} style={{
                                  borderBottom: `1px solid ${COLORS.border}22`,
                                  background: isFirst ? 'rgba(0,230,118,0.08)' : 'transparent',
                                }}>
                                  {autoOptShowAll && (
                                    <td style={{ padding: '4px', color: phaseColors[phase] || COLORS.textSec, fontSize: 9, fontWeight: 'bold' }}>
                                      {phaseLabels[phase] || phase}
                                    </td>
                                  )}
                                  <td style={{ padding: '4px', color: isTop3 ? '#00E676' : COLORS.textSec, fontWeight: isTop3 ? 'bold' : 'normal' }}>
                                    {idx + 1}
                                  </td>
                                  <td style={{ padding: '4px', color: COLORS.text, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={(row.levels || []).join(' + ')}>
                                    {(row.levels || []).map(l => l.replace('_', '').substring(0, 6)).join('+')}
                                  </td>
                                  <td style={{ padding: '4px', color: COLORS.text }} title={row.entry}>
                                    {(row.entry || '').substring(0, 10)}
                                  </td>
                                  <td style={{ padding: '4px', color: COLORS.text }} title={row.sl}>
                                    {(row.sl || '').substring(0, 8)}
                                  </td>
                                  <td style={{ padding: '4px', color: COLORS.text }} title={row.tp}>
                                    {(row.tp || '').substring(0, 8)}
                                  </td>
                                  {autoOptShowAll && (
                                    <td style={{ padding: '4px', color: COLORS.textSec, fontSize: 9 }} title={(row.exits || []).join(', ')}>
                                      {(row.exits || []).length > 0 ? (row.exits || []).map(e => e.substring(0, 6)).join(',') : '-'}
                                    </td>
                                  )}
                                  {autoOptShowAll && (
                                    <td style={{ padding: '4px', color: COLORS.textSec, fontSize: 9 }} title={(row.filters || []).join(', ')}>
                                      {(row.filters || []).length > 0 ? (row.filters || []).map(f => f.substring(0, 6)).join(',') : '-'}
                                    </td>
                                  )}
                                  <td style={{ padding: '4px', textAlign: 'right', color: row.score > 0 ? '#00E676' : COLORS.textSec, fontSize: 9 }}>
                                    {(row.score || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: row.win_rate >= 50 ? COLORS.win : COLORS.loss }}>
                                    {(row.win_rate || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.textSec }}>
                                    {row.closed || 0}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.win, fontSize: 9 }}>
                                    {row.wins || 0}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.loss, fontSize: 9 }}>
                                    {row.losses || 0}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: (row.total_pnl_r || 0) >= 0 ? COLORS.win : COLORS.loss, fontWeight: 'bold' }}>
                                    {(row.total_pnl_r || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: (row.expectancy || 0) >= 0 ? COLORS.win : COLORS.loss, fontSize: 9 }}>
                                    {(row.expectancy || 0).toFixed(2)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.textSec, fontSize: 9 }}>
                                    {(row.profit_factor || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.loss }}>
                                    {(row.max_drawdown_r || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: '#00E676', fontWeight: 'bold' }}>
                                    {(row.recovery_factor || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'right', color: COLORS.textSec, fontSize: 9 }}>
                                    {(row.avg_bars_held || 0).toFixed(1)}
                                  </td>
                                  <td style={{ padding: '4px', textAlign: 'center' }}>
                                    {row.config ? (
                                      <button onClick={() => applyAutoOptResult(row)} style={{
                                        padding: '2px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                                        fontSize: 9, background: '#00E676', color: '#FFF',
                                      }}>Aplicar</button>
                                    ) : (
                                      <span style={{ fontSize: 8, color: COLORS.textSec }}>-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ fontSize: 9, color: COLORS.textSec, marginTop: 6, textAlign: 'center' }}>
                        Click "Aplicar" para cargar la configuracion en los 5 bloques. Doble-click en columna para ordenar.
                      </div>
                    </>);
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ============================================ */}
          {/* Realtime Section */}
          {/* ============================================ */}
          {showRealtime && (
            <div style={{
              padding: '10px', background: COLORS.bgInput, borderRadius: 6,
              border: `1px solid ${rtStatus && rtStatus.running ? '#4CAF5060' : '#FF980060'}`,
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: rtStatus && rtStatus.running ? '#4CAF50' : '#FF9800', marginBottom: 8 }}>
                Ejecucion en Tiempo Real
              </div>

              <div style={{ fontSize: 11, color: COLORS.textSec, marginBottom: 8 }}>
                Activa la estrategia actual para ejecutar senales en tiempo real y enviar alertas al TradingBot (puerto 5000).
              </div>

              {/* Toggle button */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
                <button
                  onClick={handleToggleRealtime}
                  disabled={rtLoading}
                  style={{
                    flex: 1, padding: '10px 0', border: 'none', borderRadius: 4,
                    cursor: rtLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: 13,
                    background: rtStatus && rtStatus.running ? '#f44336' : '#4CAF50',
                    color: '#FFF',
                  }}
                >
                  {rtLoading ? 'Procesando...' : (rtStatus && rtStatus.running ? 'Detener Realtime' : 'Activar Realtime')}
                </button>
                {rtStatus && rtStatus.running && (
                  <button
                    onClick={handleClearRtCooldowns}
                    style={{
                      padding: '10px 12px', border: `1px solid ${COLORS.border}`, borderRadius: 4,
                      cursor: 'pointer', fontSize: 11, background: 'transparent', color: COLORS.textSec,
                    }}
                  >Clear Cooldowns</button>
                )}
              </div>

              {/* Status info */}
              {rtStatus && rtStatus.running && (
                <div style={{ fontSize: 11 }}>
                  {/* Service info row */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 8,
                    background: COLORS.bgCard, borderRadius: 4, padding: 6,
                  }}>
                    <div>
                      <span style={{ color: COLORS.textSec }}>Simbolos: </span>
                      <span style={{ color: COLORS.text }}>{(rtStatus.symbols || []).join(', ')}</span>
                    </div>
                    <div>
                      <span style={{ color: COLORS.textSec }}>Intervalo: </span>
                      <span style={{ color: COLORS.text }}>{rtStatus.interval}m</span>
                    </div>
                    <div>
                      <span style={{ color: COLORS.textSec }}>Alertas: </span>
                      <span style={{ color: rtStatus.alertsEnabled ? '#4CAF50' : '#f44336' }}>
                        {rtStatus.alertsEnabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  {rtStatus.stats && (
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8,
                    }}>
                      {[
                        ['Velas', rtStatus.stats.candles_processed],
                        ['Senales', rtStatus.stats.signals_generated],
                        ['Filtradas', rtStatus.stats.signals_filtered],
                        ['Alertas', rtStatus.stats.alerts_sent],
                      ].map(([label, val]) => (
                        <div key={label} style={{
                          background: COLORS.bgCard, borderRadius: 4, padding: '4px 6px', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: 9, color: COLORS.textSec }}>{label}</div>
                          <div style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.text }}>{val || 0}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Levels info */}
                  {rtStatus.levels && Object.keys(rtStatus.levels).length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      {Object.entries(rtStatus.levels).map(([sym, info]) => (
                        <div key={sym} style={{
                          display: 'flex', justifyContent: 'space-between', padding: '2px 0',
                          borderBottom: `1px solid ${COLORS.border}`,
                        }}>
                          <span style={{ color: COLORS.text, fontWeight: 'bold' }}>{sym}</span>
                          <span style={{ color: COLORS.textSec }}>
                            {info.active} niveles activos / {info.total} total
                            {rtStatus.buffers && rtStatus.buffers[sym]
                              ? ` | ${rtStatus.buffers[sym]} velas`
                              : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Open trades */}
                  {rtStatus.open_trades && Object.keys(rtStatus.open_trades).some(k => rtStatus.open_trades[k].length > 0) && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#FF9800', marginBottom: 4 }}>
                        Trades Abiertos
                      </div>
                      {Object.entries(rtStatus.open_trades).map(([sym, trades]) => (
                        trades.map((t, i) => (
                          <div key={`${sym}_${i}`} style={{
                            display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                            background: COLORS.bgCard, borderRadius: 3, marginBottom: 2,
                            borderLeft: `3px solid ${t.direction === 'LONG' ? '#4CAF50' : '#f44336'}`,
                          }}>
                            <span style={{ color: COLORS.text, fontWeight: 'bold' }}>
                              {sym} {t.direction}
                            </span>
                            <span style={{ color: COLORS.textSec, fontSize: 10 }}>
                              Entry: {t.entry_price ? t.entry_price.toFixed(2) : '-'} |
                              SL: {t.sl_price ? t.sl_price.toFixed(2) : '-'} |
                              TP: {t.tp_price ? t.tp_price.toFixed(2) : '-'}
                            </span>
                            <span style={{
                              fontWeight: 'bold', fontFamily: 'monospace',
                              color: (t.partial_pnl_r || 0) >= 0 ? '#4CAF50' : '#f44336',
                            }}>
                              {(t.partial_pnl_r || 0) >= 0 ? '+' : ''}{(t.partial_pnl_r || 0).toFixed(2)}R
                            </span>
                          </div>
                        ))
                      ))}
                    </div>
                  )}

                  {/* Uptime */}
                  {rtStatus.stats && rtStatus.stats.start_time > 0 && (
                    <div style={{ fontSize: 10, color: COLORS.textSec, marginTop: 6, textAlign: 'right' }}>
                      Activo desde: {new Date(rtStatus.stats.start_time * 1000).toLocaleTimeString()} |
                      Trades: {rtStatus.stats.trades_opened}O / {rtStatus.stats.trades_closed}C |
                      Cooldowns bloqueados: {rtStatus.stats.alerts_blocked_cooldown}
                    </div>
                  )}
                </div>
              )}

              {/* Not running message */}
              {(!rtStatus || !rtStatus.running) && (
                <div style={{ fontSize: 11, color: COLORS.textSec, textAlign: 'center', padding: '8px 0' }}>
                  El servicio no esta activo. Configura tu estrategia y presiona "Activar Realtime" para comenzar.
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
                {showDebugHash && result.candle_hash && (
                  <span onClick={() => { navigator.clipboard.writeText(result.candle_hash); }}
                    title="Click para copiar. Mismo hash = mismas velas = resultados deterministas"
                    style={{ marginLeft: 6, padding: '1px 5px', background: '#1a3e2a', border: '1px solid #00BFA5',
                      borderRadius: 3, color: '#80CBC4', cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 1 }}>
                    #{result.candle_hash}
                  </span>
                )}
              </div>

              {/* Filter diagnostics */}
              {result.filter_stats && (
                <details style={{ marginBottom: 6, fontSize: 10 }}>
                  <summary style={{ color: COLORS.textSec, cursor: 'pointer', userSelect: 'none' }}>
                    Diagnostico de filtros (senales: {result.filter_stats.signals_generated}, trades: {result.filter_stats.trades_opened})
                  </summary>
                  <div style={{
                    marginTop: 4, padding: '4px 6px', background: COLORS.bgCard,
                    borderRadius: 4, display: 'grid', gridTemplateColumns: '1fr auto',
                    gap: '1px 8px', color: COLORS.textSec,
                  }}>
                    <span>Senales generadas</span>
                    <span style={{ textAlign: 'right', color: COLORS.text }}>{result.filter_stats.signals_generated}</span>
                    {result.filter_stats.filtered_direction > 0 && <>
                      <span>Filtradas por direccion</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_direction}</span>
                    </>}
                    {result.filter_stats.filtered_confluence > 0 && <>
                      <span>Filtradas por confluencia</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_confluence}</span>
                    </>}
                    {result.filter_stats.filtered_max_trades_seg > 0 && <>
                      <span>Filtradas max trades/segmento</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_max_trades_seg}</span>
                    </>}
                    {result.filter_stats.filtered_context && Object.entries(result.filter_stats.filtered_context).map(([ft, cnt]) => (
                      <React.Fragment key={ft}>
                        <span>Filtradas por {ft}</span>
                        <span style={{ textAlign: 'right', color: COLORS.loss }}>-{cnt}</span>
                      </React.Fragment>
                    ))}
                    {result.filter_stats.filtered_sl_invalid > 0 && <>
                      <span>SL invalido</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_sl_invalid}</span>
                    </>}
                    {result.filter_stats.filtered_sl_direction > 0 && <>
                      <span>SL direccion incorrecta</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_sl_direction}</span>
                    </>}
                    {result.filter_stats.filtered_tp_invalid > 0 && <>
                      <span>TP invalido</span>
                      <span style={{ textAlign: 'right', color: COLORS.loss }}>-{result.filter_stats.filtered_tp_invalid}</span>
                    </>}
                    <span style={{ fontWeight: 'bold', color: COLORS.text, borderTop: `1px solid ${COLORS.border}`, paddingTop: 2, marginTop: 2 }}>Trades abiertos</span>
                    <span style={{ textAlign: 'right', fontWeight: 'bold', color: COLORS.win, borderTop: `1px solid ${COLORS.border}`, paddingTop: 2, marginTop: 2 }}>{result.filter_stats.trades_opened}</span>
                  </div>
                </details>
              )}

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
