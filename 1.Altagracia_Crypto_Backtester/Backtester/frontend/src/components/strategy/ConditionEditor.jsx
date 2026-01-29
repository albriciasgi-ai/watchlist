// ConditionEditor.jsx
// Editor de condiciones individuales para estrategias

import React from 'react';

// Tipos de condiciones disponibles
const CONDITION_TYPES = [
  { value: 'zone_quality', label: 'Calidad de zona', unit: 'score', min: 0, max: 100 },
  { value: 'zone_touches', label: 'Toques de zona', unit: 'toques', min: 1, max: 20 },
  { value: 'zone_age', label: 'Edad de zona', unit: 'horas', min: 0, max: 168 },
  { value: 'candle_pattern', label: 'Patrón de vela', unit: 'patrón', isMultiSelect: true },
  { value: 'volume', label: 'Volumen', unit: 'condición', isSelect: true },
  { value: 'rsi', label: 'RSI', unit: 'valor', min: 0, max: 100 },
  { value: 'trend', label: 'Tendencia', unit: 'dirección', isSelect: true },
  { value: 'price_distance', label: 'Distancia al extremo', unit: '%', min: 0, max: 5 }
];

// Operadores por tipo
const OPERATORS = {
  numeric: [
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'eq', label: '=' },
    { value: 'between', label: 'entre' }
  ],
  select: [
    { value: 'eq', label: '=' },
    { value: 'in', label: 'en' }
  ]
};

// Opciones para selects
const SELECT_OPTIONS = {
  candle_pattern: [
    { value: 'hammer', label: 'Hammer' },
    { value: 'inverted_hammer', label: 'Inverted Hammer' },
    { value: 'engulfing', label: 'Engulfing' },
    { value: 'doji', label: 'Doji' },
    { value: 'shooting_star', label: 'Shooting Star' },
    { value: 'morning_star', label: 'Morning Star' },
    { value: 'evening_star', label: 'Evening Star' }
  ],
  volume: [
    { value: 'above_average', label: 'Arriba del promedio' },
    { value: 'below_average', label: 'Debajo del promedio' },
    { value: 'spike', label: 'Spike (>2x promedio)' },
    { value: 'low', label: 'Muy bajo (<0.5x promedio)' }
  ],
  trend: [
    { value: 'bullish', label: 'Alcista' },
    { value: 'bearish', label: 'Bajista' },
    { value: 'sideways', label: 'Lateral' }
  ]
};

const ConditionEditor = ({ condition, onChange, onRemove }) => {
  const typeConfig = CONDITION_TYPES.find(t => t.value === condition.type) || CONDITION_TYPES[0];
  const isSelectType = typeConfig.isSelect || typeConfig.isMultiSelect;
  const operators = isSelectType ? OPERATORS.select : OPERATORS.numeric;

  const handleTypeChange = (newType) => {
    const newConfig = CONDITION_TYPES.find(t => t.value === newType);
    onChange({
      ...condition,
      type: newType,
      operator: newConfig.isSelect || newConfig.isMultiSelect ? 'eq' : 'gte',
      value: newConfig.isSelect ? SELECT_OPTIONS[newType]?.[0]?.value : (newConfig.min || 0),
      value2: null
    });
  };

  const handleOperatorChange = (newOperator) => {
    onChange({
      ...condition,
      operator: newOperator,
      value2: newOperator === 'between' ? condition.value : null
    });
  };

  const handleValueChange = (value) => {
    onChange({ ...condition, value });
  };

  const handleValue2Change = (value2) => {
    onChange({ ...condition, value2 });
  };

  const handleMultiSelectChange = (selectedValue) => {
    const currentValues = Array.isArray(condition.value) ? condition.value : [];
    const newValues = currentValues.includes(selectedValue)
      ? currentValues.filter(v => v !== selectedValue)
      : [...currentValues, selectedValue];
    onChange({ ...condition, value: newValues });
  };

  const handleToggleEnabled = () => {
    onChange({ ...condition, enabled: !condition.enabled });
  };

  return (
    <div className={`condition-editor ${condition.enabled ? '' : 'disabled'}`}>
      <div className="ce-row">
        {/* Toggle enabled */}
        <button
          className={`ce-toggle ${condition.enabled ? 'on' : 'off'}`}
          onClick={handleToggleEnabled}
          title={condition.enabled ? 'Desactivar' : 'Activar'}
        >
          {condition.enabled ? '✓' : '○'}
        </button>

        {/* Tipo de condición */}
        <select
          value={condition.type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="ce-type"
        >
          {CONDITION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Operador */}
        <select
          value={condition.operator}
          onChange={(e) => handleOperatorChange(e.target.value)}
          className="ce-operator"
        >
          {operators.map(op => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>

        {/* Valor - depende del tipo */}
        {typeConfig.isMultiSelect ? (
          // Multi-select (patrones de vela)
          <div className="ce-multiselect">
            {SELECT_OPTIONS[condition.type]?.map(opt => (
              <label key={opt.value} className="ce-checkbox">
                <input
                  type="checkbox"
                  checked={Array.isArray(condition.value) && condition.value.includes(opt.value)}
                  onChange={() => handleMultiSelectChange(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        ) : typeConfig.isSelect ? (
          // Single select
          <select
            value={condition.value}
            onChange={(e) => handleValueChange(e.target.value)}
            className="ce-value"
          >
            {SELECT_OPTIONS[condition.type]?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          // Numeric input
          <>
            <input
              type="number"
              value={condition.value}
              onChange={(e) => handleValueChange(parseFloat(e.target.value))}
              min={typeConfig.min}
              max={typeConfig.max}
              className="ce-value"
            />
            {condition.operator === 'between' && (
              <>
                <span className="ce-separator">y</span>
                <input
                  type="number"
                  value={condition.value2 || ''}
                  onChange={(e) => handleValue2Change(parseFloat(e.target.value))}
                  min={typeConfig.min}
                  max={typeConfig.max}
                  className="ce-value"
                />
              </>
            )}
            <span className="ce-unit">{typeConfig.unit}</span>
          </>
        )}

        {/* Botón eliminar */}
        <button
          className="ce-remove"
          onClick={onRemove}
          title="Eliminar condición"
        >
          ×
        </button>
      </div>

      {/* Preview de la condición en texto */}
      <div className="ce-preview">
        {generateConditionText(condition, typeConfig)}
      </div>
    </div>
  );
};

// Genera texto legible de la condición
function generateConditionText(condition, typeConfig) {
  const operatorText = {
    gte: '≥',
    lte: '≤',
    eq: '=',
    between: 'entre',
    in: 'es'
  }[condition.operator] || condition.operator;

  let valueText;
  if (typeConfig.isMultiSelect && Array.isArray(condition.value)) {
    const labels = condition.value.map(v =>
      SELECT_OPTIONS[condition.type]?.find(o => o.value === v)?.label || v
    );
    valueText = labels.join(', ') || '(ninguno)';
  } else if (typeConfig.isSelect) {
    valueText = SELECT_OPTIONS[condition.type]?.find(o => o.value === condition.value)?.label || condition.value;
  } else if (condition.operator === 'between') {
    valueText = `${condition.value} y ${condition.value2 || '?'}`;
  } else {
    valueText = `${condition.value} ${typeConfig.unit}`;
  }

  return `${typeConfig.label} ${operatorText} ${valueText}`;
}

export default ConditionEditor;
