// StrategyBuilder.jsx
// UI principal para crear y editar estrategias de trading

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import ConditionEditor from './ConditionEditor';
import './StrategyBuilder.css';

// Opciones para selects
const ENTRY_TRIGGERS = [
  { value: 'price_touches_zone', label: 'Precio toca zona' },
  { value: 'price_enters_zone', label: 'Precio entra en zona' },
  { value: 'price_breaks_zone', label: 'Precio rompe zona' },
  { value: 'candle_closes_in_zone', label: 'Vela cierra en zona' }
];

const DIRECTIONS = [
  { value: 'BOTH', label: 'Ambos (Long y Short)' },
  { value: 'LONG', label: 'Solo Long' },
  { value: 'SHORT', label: 'Solo Short' }
];

const SIZING_METHODS = [
  { value: 'fixed_risk', label: 'Riesgo fijo (% del capital)' },
  { value: 'fixed_amount', label: 'Monto fijo (USD)' },
  { value: 'percent_equity', label: '% del equity' }
];

const STOP_LOSS_TYPES = [
  { value: 'below_zone', label: 'Debajo/arriba de zona' },
  { value: 'atr_multiple', label: 'Múltiplo de ATR' },
  { value: 'fixed_percent', label: 'Porcentaje fijo' },
  { value: 'swing_point', label: 'Swing point previo' }
];

const TAKE_PROFIT_TYPES = [
  { value: 'risk_reward', label: 'Ratio Riesgo/Beneficio' },
  { value: 'opposite_zone', label: 'Zona opuesta' },
  { value: 'fixed_percent', label: 'Porcentaje fijo' },
  { value: 'atr_multiple', label: 'Múltiplo de ATR' }
];

const ZONE_METHODS = [
  { value: 'pivot_cluster', label: 'Pivot Cluster' },
  { value: 'atr_based', label: 'ATR Based' },
  { value: 'volume_profile', label: 'Volume Profile' },
  { value: 'price_action', label: 'Price Action' }
];

// Estrategia por defecto
const DEFAULT_STRATEGY = {
  name: 'Nueva Estrategia',
  description: '',
  zone_config: {
    method: 'pivot_cluster',
    params: {
      pivot_tolerance_pct: 0.3,
      pivot_min_touches: 3,
      pivot_swing_bars: 5,
      max_price_range_pct: 5.0
    }
  },
  entry: {
    trigger: 'price_touches_zone',
    direction: 'BOTH',
    conditions: [],
    require_all_conditions: true,
    confirmation_candles: 1
  },
  risk_management: {
    sizing: {
      method: 'fixed_risk',
      risk_percent: 1.0,
      fixed_amount: 100,
      equity_percent: 5.0
    },
    stop_loss: {
      type: 'below_zone',
      buffer_percent: 0.1,
      atr_multiple: 1.5,
      fixed_percent: 2.0,
      use_trailing: false,
      trailing_activation: 1.0,
      trailing_distance: 0.5
    },
    take_profit: {
      type: 'risk_reward',
      risk_reward_ratio: 2.0,
      fixed_percent: 4.0,
      atr_multiple: 3.0,
      partial_exits: []
    }
  },
  filters: {
    max_open_trades: 1,
    min_time_between_trades: 60,
    max_daily_trades: 5,
    max_daily_loss_percent: 3.0,
    trading_hours_start: null,
    trading_hours_end: null,
    min_zone_score: 50
  },
  tags: [],
  is_active: true
};

const StrategyBuilder = ({
  strategyId,
  onSave,
  onClose,
  onRunBacktest,  // Callback para ejecutar backtest
  symbol,         // Símbolo actual del backtester
  currentTime,    // Timestamp actual de la simulación
  candles         // Velas disponibles
}) => {
  const [strategy, setStrategy] = useState(DEFAULT_STRATEGY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [error, setError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [activeSection, setActiveSection] = useState('basic'); // basic, entry, risk, filters
  const [templates, setTemplates] = useState([]);
  const [isDirty, setIsDirty] = useState(false);

  // Cargar estrategia existente o templates
  useEffect(() => {
    if (strategyId) {
      loadStrategy(strategyId);
    } else {
      loadTemplates();
    }
  }, [strategyId]);

  const loadStrategy = async (id) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`);
      const data = await response.json();
      if (data.success) {
        setStrategy(data.strategy);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies/templates`);
      const data = await response.json();
      if (data.success) {
        setTemplates(data.templates);
      }
    } catch (err) {
      console.error('Error loading templates:', err);
    }
  };

  const handleChange = useCallback((path, value) => {
    setStrategy(prev => {
      const newStrategy = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = newStrategy;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return newStrategy;
    });
    setIsDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const url = strategyId
        ? `${API_BASE_URL}/api/strategies/${strategyId}`
        : `${API_BASE_URL}/api/strategies`;
      const method = strategyId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy)
      });

      const data = await response.json();

      if (data.success) {
        setIsDirty(false);
        if (onSave) onSave(data.strategy);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy)
      });
      const data = await response.json();
      setValidationResult(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLoadTemplate = async (templateId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: templateId })
      });
      const data = await response.json();
      if (data.success) {
        setStrategy(data.strategy);
        setIsDirty(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // 🎯 NUEVO: Ejecutar backtest
  const handleRunBacktest = async () => {
    if (!symbol) {
      setError('Selecciona un símbolo antes de ejecutar el backtest');
      return;
    }

    // Primero validar
    await handleValidate();
    if (validationResult && !validationResult.valid) {
      return;
    }

    setRunningBacktest(true);
    setError(null);

    try {
      // Si la estrategia está guardada, usar el ID
      // Si no, hacer quick-backtest con la estrategia inline
      const url = strategyId
        ? `${API_BASE_URL}/api/strategies/${strategyId}/backtest`
        : `${API_BASE_URL}/api/strategies/quick-backtest`;

      const body = strategyId
        ? { symbol, current_time: currentTime }
        : { strategy, symbol, current_time: currentTime };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (data.success) {
        console.log('[StrategyBuilder] Backtest completado:', data.result);
        if (onRunBacktest) {
          onRunBacktest(data.result);
        }
      } else {
        setError(data.error || 'Error ejecutando backtest');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunningBacktest(false);
    }
  };

  const handleAddCondition = () => {
    const newCondition = {
      type: 'zone_quality',
      operator: 'gte',
      value: 50,
      enabled: true
    };
    handleChange('entry.conditions', [...strategy.entry.conditions, newCondition]);
  };

  const handleRemoveCondition = (index) => {
    const newConditions = strategy.entry.conditions.filter((_, i) => i !== index);
    handleChange('entry.conditions', newConditions);
  };

  const handleUpdateCondition = (index, condition) => {
    const newConditions = [...strategy.entry.conditions];
    newConditions[index] = condition;
    handleChange('entry.conditions', newConditions);
  };

  if (loading) {
    return <div className="sb-loading">Cargando estrategia...</div>;
  }

  return (
    <div className="sb-container">
      {/* Header */}
      <div className="sb-header">
        <h2>{strategyId ? 'Editar Estrategia' : 'Nueva Estrategia'}</h2>
        <div className="sb-header-actions">
          <button onClick={handleValidate} className="sb-btn secondary">
            Validar
          </button>
          <button onClick={handleSave} className="sb-btn primary" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={handleRunBacktest}
            className="sb-btn backtest"
            disabled={runningBacktest || !symbol}
            title={!symbol ? 'Selecciona un símbolo primero' : 'Ejecutar backtest con esta estrategia'}
          >
            {runningBacktest ? '⏳ Ejecutando...' : '▶ Backtest'}
          </button>
          {onClose && (
            <button onClick={onClose} className="sb-btn close">×</button>
          )}
        </div>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <div className={`sb-validation ${validationResult.valid ? 'valid' : 'invalid'}`}>
          {validationResult.errors.length > 0 && (
            <div className="sb-validation-errors">
              <strong>Errores:</strong>
              <ul>
                {validationResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {validationResult.warnings.length > 0 && (
            <div className="sb-validation-warnings">
              <strong>Advertencias:</strong>
              <ul>
                {validationResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {validationResult.valid && validationResult.errors.length === 0 && (
            <span className="sb-validation-ok">✓ Estrategia válida</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && <div className="sb-error">{error}</div>}

      {/* Templates */}
      {!strategyId && templates.length > 0 && (
        <div className="sb-templates">
          <span>Cargar template:</span>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => handleLoadTemplate(t.id)}
              className="sb-template-btn"
              title={t.description}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="sb-tabs">
        <button
          className={activeSection === 'basic' ? 'active' : ''}
          onClick={() => setActiveSection('basic')}
        >
          Básico
        </button>
        <button
          className={activeSection === 'entry' ? 'active' : ''}
          onClick={() => setActiveSection('entry')}
        >
          Entrada
        </button>
        <button
          className={activeSection === 'risk' ? 'active' : ''}
          onClick={() => setActiveSection('risk')}
        >
          Riesgo
        </button>
        <button
          className={activeSection === 'filters' ? 'active' : ''}
          onClick={() => setActiveSection('filters')}
        >
          Filtros
        </button>
      </div>

      {/* Content */}
      <div className="sb-content">
        {/* BASIC SECTION */}
        {activeSection === 'basic' && (
          <div className="sb-section">
            <div className="sb-field">
              <label>Nombre de la estrategia</label>
              <input
                type="text"
                value={strategy.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Ej: Range Bounce Conservative"
              />
            </div>

            <div className="sb-field">
              <label>Descripción</label>
              <textarea
                value={strategy.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Describe brevemente la estrategia..."
                rows={3}
              />
            </div>

            <div className="sb-field-group">
              <div className="sb-field">
                <label>Método de detección de zonas</label>
                <select
                  value={strategy.zone_config.method}
                  onChange={(e) => handleChange('zone_config.method', e.target.value)}
                >
                  {ZONE_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="sb-field">
                <label>Score mínimo de zona</label>
                <input
                  type="number"
                  value={strategy.filters.min_zone_score}
                  onChange={(e) => handleChange('filters.min_zone_score', parseFloat(e.target.value))}
                  min={0}
                  max={100}
                />
              </div>
            </div>

            <div className="sb-field">
              <label>Tags (separados por coma)</label>
              <input
                type="text"
                value={strategy.tags.join(', ')}
                onChange={(e) => handleChange('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                placeholder="range, bounce, conservative"
              />
            </div>

            <div className="sb-field checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={strategy.is_active}
                  onChange={(e) => handleChange('is_active', e.target.checked)}
                />
                Estrategia activa
              </label>
            </div>
          </div>
        )}

        {/* ENTRY SECTION */}
        {activeSection === 'entry' && (
          <div className="sb-section">
            <div className="sb-field-group">
              <div className="sb-field">
                <label>Trigger de entrada</label>
                <select
                  value={strategy.entry.trigger}
                  onChange={(e) => handleChange('entry.trigger', e.target.value)}
                >
                  {ENTRY_TRIGGERS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div className="sb-field">
                <label>Dirección</label>
                <select
                  value={strategy.entry.direction}
                  onChange={(e) => handleChange('entry.direction', e.target.value)}
                >
                  {DIRECTIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sb-field-group">
              <div className="sb-field">
                <label>Velas de confirmación</label>
                <input
                  type="number"
                  value={strategy.entry.confirmation_candles}
                  onChange={(e) => handleChange('entry.confirmation_candles', parseInt(e.target.value))}
                  min={0}
                  max={5}
                />
              </div>

              <div className="sb-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={strategy.entry.require_all_conditions}
                    onChange={(e) => handleChange('entry.require_all_conditions', e.target.checked)}
                  />
                  Requerir TODAS las condiciones (AND)
                </label>
              </div>
            </div>

            <div className="sb-conditions">
              <div className="sb-conditions-header">
                <h4>Condiciones de entrada</h4>
                <button onClick={handleAddCondition} className="sb-btn small">
                  + Agregar condición
                </button>
              </div>

              {strategy.entry.conditions.length === 0 ? (
                <div className="sb-conditions-empty">
                  No hay condiciones. El trade se ejecutará solo por el trigger.
                </div>
              ) : (
                <div className="sb-conditions-list">
                  {strategy.entry.conditions.map((condition, index) => (
                    <ConditionEditor
                      key={index}
                      condition={condition}
                      onChange={(c) => handleUpdateCondition(index, c)}
                      onRemove={() => handleRemoveCondition(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* RISK MANAGEMENT SECTION */}
        {activeSection === 'risk' && (
          <div className="sb-section">
            {/* Position Sizing */}
            <div className="sb-subsection">
              <h4>Tamaño de posición</h4>
              <div className="sb-field-group">
                <div className="sb-field">
                  <label>Método</label>
                  <select
                    value={strategy.risk_management.sizing.method}
                    onChange={(e) => handleChange('risk_management.sizing.method', e.target.value)}
                  >
                    {SIZING_METHODS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {strategy.risk_management.sizing.method === 'fixed_risk' && (
                  <div className="sb-field">
                    <label>Riesgo por trade (%)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.sizing.risk_percent}
                      onChange={(e) => handleChange('risk_management.sizing.risk_percent', parseFloat(e.target.value))}
                      min={0.1}
                      max={10}
                      step={0.1}
                    />
                  </div>
                )}

                {strategy.risk_management.sizing.method === 'fixed_amount' && (
                  <div className="sb-field">
                    <label>Monto (USD)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.sizing.fixed_amount}
                      onChange={(e) => handleChange('risk_management.sizing.fixed_amount', parseFloat(e.target.value))}
                      min={10}
                      step={10}
                    />
                  </div>
                )}

                {strategy.risk_management.sizing.method === 'percent_equity' && (
                  <div className="sb-field">
                    <label>% del equity</label>
                    <input
                      type="number"
                      value={strategy.risk_management.sizing.equity_percent}
                      onChange={(e) => handleChange('risk_management.sizing.equity_percent', parseFloat(e.target.value))}
                      min={1}
                      max={100}
                      step={1}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Stop Loss */}
            <div className="sb-subsection">
              <h4>Stop Loss</h4>
              <div className="sb-field-group">
                <div className="sb-field">
                  <label>Tipo</label>
                  <select
                    value={strategy.risk_management.stop_loss.type}
                    onChange={(e) => handleChange('risk_management.stop_loss.type', e.target.value)}
                  >
                    {STOP_LOSS_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {strategy.risk_management.stop_loss.type === 'below_zone' && (
                  <div className="sb-field">
                    <label>Buffer adicional (%)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.stop_loss.buffer_percent}
                      onChange={(e) => handleChange('risk_management.stop_loss.buffer_percent', parseFloat(e.target.value))}
                      min={0}
                      max={2}
                      step={0.1}
                    />
                  </div>
                )}

                {strategy.risk_management.stop_loss.type === 'atr_multiple' && (
                  <div className="sb-field">
                    <label>Múltiplo ATR</label>
                    <input
                      type="number"
                      value={strategy.risk_management.stop_loss.atr_multiple}
                      onChange={(e) => handleChange('risk_management.stop_loss.atr_multiple', parseFloat(e.target.value))}
                      min={0.5}
                      max={5}
                      step={0.1}
                    />
                  </div>
                )}

                {strategy.risk_management.stop_loss.type === 'fixed_percent' && (
                  <div className="sb-field">
                    <label>Porcentaje (%)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.stop_loss.fixed_percent}
                      onChange={(e) => handleChange('risk_management.stop_loss.fixed_percent', parseFloat(e.target.value))}
                      min={0.1}
                      max={10}
                      step={0.1}
                    />
                  </div>
                )}
              </div>

              <div className="sb-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={strategy.risk_management.stop_loss.use_trailing}
                    onChange={(e) => handleChange('risk_management.stop_loss.use_trailing', e.target.checked)}
                  />
                  Usar trailing stop
                </label>
              </div>

              {strategy.risk_management.stop_loss.use_trailing && (
                <div className="sb-field-group">
                  <div className="sb-field">
                    <label>Activar a (% profit)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.stop_loss.trailing_activation}
                      onChange={(e) => handleChange('risk_management.stop_loss.trailing_activation', parseFloat(e.target.value))}
                      min={0.1}
                      max={10}
                      step={0.1}
                    />
                  </div>
                  <div className="sb-field">
                    <label>Distancia (%)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.stop_loss.trailing_distance}
                      onChange={(e) => handleChange('risk_management.stop_loss.trailing_distance', parseFloat(e.target.value))}
                      min={0.1}
                      max={5}
                      step={0.1}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Take Profit */}
            <div className="sb-subsection">
              <h4>Take Profit</h4>
              <div className="sb-field-group">
                <div className="sb-field">
                  <label>Tipo</label>
                  <select
                    value={strategy.risk_management.take_profit.type}
                    onChange={(e) => handleChange('risk_management.take_profit.type', e.target.value)}
                  >
                    {TAKE_PROFIT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {strategy.risk_management.take_profit.type === 'risk_reward' && (
                  <div className="sb-field">
                    <label>Ratio R:R</label>
                    <input
                      type="number"
                      value={strategy.risk_management.take_profit.risk_reward_ratio}
                      onChange={(e) => handleChange('risk_management.take_profit.risk_reward_ratio', parseFloat(e.target.value))}
                      min={0.5}
                      max={10}
                      step={0.1}
                    />
                  </div>
                )}

                {strategy.risk_management.take_profit.type === 'fixed_percent' && (
                  <div className="sb-field">
                    <label>Porcentaje (%)</label>
                    <input
                      type="number"
                      value={strategy.risk_management.take_profit.fixed_percent}
                      onChange={(e) => handleChange('risk_management.take_profit.fixed_percent', parseFloat(e.target.value))}
                      min={0.5}
                      max={20}
                      step={0.5}
                    />
                  </div>
                )}

                {strategy.risk_management.take_profit.type === 'atr_multiple' && (
                  <div className="sb-field">
                    <label>Múltiplo ATR</label>
                    <input
                      type="number"
                      value={strategy.risk_management.take_profit.atr_multiple}
                      onChange={(e) => handleChange('risk_management.take_profit.atr_multiple', parseFloat(e.target.value))}
                      min={1}
                      max={10}
                      step={0.5}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FILTERS SECTION */}
        {activeSection === 'filters' && (
          <div className="sb-section">
            <div className="sb-field-group">
              <div className="sb-field">
                <label>Max trades abiertos</label>
                <input
                  type="number"
                  value={strategy.filters.max_open_trades}
                  onChange={(e) => handleChange('filters.max_open_trades', parseInt(e.target.value))}
                  min={1}
                  max={10}
                />
              </div>

              <div className="sb-field">
                <label>Max trades por día</label>
                <input
                  type="number"
                  value={strategy.filters.max_daily_trades}
                  onChange={(e) => handleChange('filters.max_daily_trades', parseInt(e.target.value))}
                  min={1}
                  max={50}
                />
              </div>
            </div>

            <div className="sb-field-group">
              <div className="sb-field">
                <label>Tiempo mínimo entre trades (min)</label>
                <input
                  type="number"
                  value={strategy.filters.min_time_between_trades}
                  onChange={(e) => handleChange('filters.min_time_between_trades', parseInt(e.target.value))}
                  min={0}
                  max={1440}
                />
              </div>

              <div className="sb-field">
                <label>Max pérdida diaria (%)</label>
                <input
                  type="number"
                  value={strategy.filters.max_daily_loss_percent}
                  onChange={(e) => handleChange('filters.max_daily_loss_percent', parseFloat(e.target.value))}
                  min={0.5}
                  max={20}
                  step={0.5}
                />
              </div>
            </div>

            <div className="sb-subsection">
              <h4>Horario de trading (opcional)</h4>
              <div className="sb-field-group">
                <div className="sb-field">
                  <label>Hora inicio (0-23)</label>
                  <input
                    type="number"
                    value={strategy.filters.trading_hours_start ?? ''}
                    onChange={(e) => handleChange('filters.trading_hours_start', e.target.value ? parseInt(e.target.value) : null)}
                    min={0}
                    max={23}
                    placeholder="24/7"
                  />
                </div>

                <div className="sb-field">
                  <label>Hora fin (0-23)</label>
                  <input
                    type="number"
                    value={strategy.filters.trading_hours_end ?? ''}
                    onChange={(e) => handleChange('filters.trading_hours_end', e.target.value ? parseInt(e.target.value) : null)}
                    min={0}
                    max={23}
                    placeholder="24/7"
                  />
                </div>
              </div>
              <p className="sb-hint">Dejar vacío para operar 24/7</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer con resumen */}
      <div className="sb-footer">
        <div className="sb-summary">
          <span><strong>Trigger:</strong> {ENTRY_TRIGGERS.find(t => t.value === strategy.entry.trigger)?.label}</span>
          <span><strong>Dirección:</strong> {strategy.entry.direction}</span>
          <span><strong>Condiciones:</strong> {strategy.entry.conditions.length}</span>
          <span><strong>R:R:</strong> 1:{strategy.risk_management.take_profit.risk_reward_ratio}</span>
        </div>
        {isDirty && <span className="sb-unsaved">● Sin guardar</span>}
      </div>
    </div>
  );
};

export default StrategyBuilder;
