import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { cleanSmcSettings, defaultSmcConfig, saveSmcSettings } from './indicators/smcStructure.js';

const copy = (config) => JSON.parse(JSON.stringify(config));

const NumberRow = ({ label, value, onChange, min, max, step = 1, hint }) => (
  <div className="setting-row">
    <label>{label}</label>
    <input type="number" min={min} max={max} step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    {hint && <span className="hint">{hint}</span>}
  </div>
);

const Check = ({ label, checked, onChange, hint }) => (
  <div className="setting-row" style={{ marginBottom: '8px' }}>
    <label className="checkbox-label">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
    {hint && <span className="hint">{hint}</span>}
  </div>
);

/** Ajustes de la estructura SMC. Aplican a todos los marcos del símbolo */
const SMCSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => copy(indicator.config));
  const set = (section, key, value) => setValues(previous => (
    key === null ? { ...previous, [section]: value } : { ...previous, [section]: { ...previous[section], [key]: value } }
  ));
  const { internal, swing, ob, equal, zones, strongWeak, levels } = values;

  const handleApply = () => {
    const settings = cleanSmcSettings(values);
    saveSmcSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Estructura SMC - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Estructura</h4>
            <span className="hint">
              Un pivote es el extremo de su tramo cuando las velas siguientes no lo pasan: se sabe esas velas después. Un cierre más allá
              del último pivote es BOS si sigue la tendencia y CHoCH si la da vuelta.
            </span>
            <Check label="Estructura interna" checked={internal.show} onChange={(v) => set('internal', 'show', v)} />
            <div style={{ paddingLeft: '18px' }}>
              <NumberRow label="Velas del pivote" value={internal.length} min={2} max={50} onChange={(v) => set('internal', 'length', v)} />
              <Check label="BOS" checked={internal.bos} onChange={(v) => set('internal', 'bos', v)} />
              <Check label="CHoCH" checked={internal.choch} onChange={(v) => set('internal', 'choch', v)} />
            </div>
            <Check label="Estructura mayor" checked={swing.show} onChange={(v) => set('swing', 'show', v)} />
            <div style={{ paddingLeft: '18px' }}>
              <NumberRow label="Velas del pivote" value={swing.length} min={5} max={300} onChange={(v) => set('swing', 'length', v)} hint="LuxAlgo usa 50: el pivote se sabe 50 velas después." />
              <Check label="BOS" checked={swing.bos} onChange={(v) => set('swing', 'bos', v)} />
              <Check label="CHoCH" checked={swing.choch} onChange={(v) => set('swing', 'choch', v)} />
              <Check label="Etiquetas HH, HL, LH y LL" checked={swing.labels} onChange={(v) => set('swing', 'labels', v)} />
            </div>
          </div>

          <div className="settings-section">
            <h4>Order blocks</h4>
            <span className="hint">Al romper la estructura: la vela del extremo entre el pivote roto y la ruptura. Los rotos no se borran.</span>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Check label="De la estructura interna" checked={ob.internal} onChange={(v) => set('ob', 'internal', v)} />
              <NumberRow label="cuántos activos" value={ob.internalCount} min={0} max={50} onChange={(v) => set('ob', 'internalCount', v)} />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Check label="De la estructura mayor" checked={ob.swing} onChange={(v) => set('ob', 'swing', v)} />
              <NumberRow label="cuántos activos" value={ob.swingCount} min={0} max={50} onChange={(v) => set('ob', 'swingCount', v)} />
            </div>
            <div className="setting-row">
              <label>Qué vela es el order block</label>
              <select value={ob.pick} onChange={(e) => set('ob', 'pick', e.target.value)}>
                <option value="extreme">La del mínimo más bajo (o el máximo más alto)</option>
                <option value="opposite">La última vela contraria antes de ese extremo</option>
              </select>
            </div>
            <div className="setting-row">
              <label>Su zona</label>
              <select value={ob.area} onChange={(e) => set('ob', 'area', e.target.value)}>
                <option value="full">La vela entera</option>
                <option value="body">Solo el cuerpo</option>
              </select>
            </div>
            <div className="setting-row">
              <label>Qué lo rompe</label>
              <select value={ob.mitigation} onChange={(e) => set('ob', 'mitigation', e.target.value)}>
                <option value="close">Un cierre más allá de su borde lejano</option>
                <option value="wick">Una mecha más allá de su borde lejano</option>
              </select>
            </div>
            <Check label="Los rotos siguen a la vista, tenues, hasta la vela que los rompió" checked={ob.showBroken} onChange={(v) => set('ob', 'showBroken', v)} />
            <Check label="Breakers: un OB roto pasa al lado contrario" checked={ob.breakers} onChange={(v) => set('ob', 'breakers', v)}
              hint="Hasta que un cierre lo atraviesa de vuelta." />
            <Check label="Línea de la mitad" checked={ob.showMid} onChange={(v) => set('ob', 'showMid', v)} />
            <Check label="POC y delta reales de su vela (almacén de trades)" checked={ob.realVolume} onChange={(v) => set('ob', 'realVolume', v)}
              hint="Solo en las monedas con almacén. El POC es el precio donde más se negoció dentro de la vela." />
          </div>

          <div className="settings-section">
            <h4>Iguales (EQH y EQL)</h4>
            <Check label="Mostrar" checked={equal.show} onChange={(v) => set('equal', 'show', v)} />
            <NumberRow label="Velas del pivote" value={equal.length} min={2} max={20} onChange={(v) => set('equal', 'length', v)} />
            <NumberRow label="Distancia máxima entre los dos (ATR de 200 velas)" value={equal.threshold} min={0.01} max={2} step={0.05} onChange={(v) => set('equal', 'threshold', v)} />
            <Check label="Marcar el barrido (y si cerró de vuelta)" checked={equal.sweeps} onChange={(v) => set('equal', 'sweeps', v)} />
            <Check label="Lo liquidado cerca del nivel en los 30 días antes" checked={equal.liquidations} onChange={(v) => set('equal', 'liquidations', v)}
              hint="A 0.15% del nivel, con las fuentes del indicador Liquidaciones. Con fecha oculta no se muestra el monto." />
          </div>

          <div className="settings-section">
            <h4>Rango</h4>
            <span className="hint">Entre el último máximo y el último mínimo de la estructura mayor, estirado por lo que los pasa.</span>
            <Check label="Premium y discount" checked={zones.show} onChange={(v) => set('zones', 'show', v)} />
            <div className="setting-row">
              <label>Cómo</label>
              <select value={zones.style} onChange={(e) => set('zones', 'style', e.target.value)}>
                <option value="half">Arriba o abajo de la mitad</option>
                <option value="bands">Franjas de 5% en los extremos y el equilibrio (como LuxAlgo)</option>
              </select>
            </div>
            <Check label="Máximo y mínimo fuertes o débiles" checked={strongWeak.show} onChange={(v) => set('strongWeak', 'show', v)}
              hint="Con la tendencia alcista el mínimo es fuerte y el máximo débil." />
          </div>

          <div className="settings-section">
            <h4>Niveles anteriores (UTC)</h4>
            <Check label="Día anterior (PDH y PDL)" checked={levels.daily} onChange={(v) => set('levels', 'daily', v)} />
            <Check label="Semana anterior, desde el lunes (PWH y PWL)" checked={levels.weekly} onChange={(v) => set('levels', 'weekly', v)} />
            <Check label="Mes anterior (PMH y PML)" checked={levels.monthly} onChange={(v) => set('levels', 'monthly', v)} />
          </div>

          <div className="settings-section">
            <h4>Dibujo</h4>
            <Check label="Punteado desde la vela de cada pieza hasta la vela en que se supo" checked={values.showBefore} onChange={(v) => set('showBefore', null, v)} />
            <div className="setting-row">
              <label>Opacidad de los order blocks (%)</label>
              <input type="number" min="2" max="60" step="2" value={Math.round(values.obOpacity * 100)} onChange={(e) => set('obOpacity', null, e.target.value / 100)} />
            </div>
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="setting-row">
                <label>Alcista</label>
                <input type="color" value={values.bullColor} onChange={(e) => set('bullColor', null, e.target.value)} />
              </div>
              <div className="setting-row">
                <label>Bajista</label>
                <input type="color" value={values.bearColor} onChange={(e) => set('bearColor', null, e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultSmcConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default SMCSettings;
