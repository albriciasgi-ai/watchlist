import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { cleanWilliamsSettings, defaultWilliamsConfig, saveWilliamsSettings } from './indicators/williams.js';

// Secciones de la configuración que muestra el modal de cada indicador
const SECTIONS = {
  'Alligator': ['alligator'],
  'Fractales': ['fractals'],
  'AO': ['ao'],
  'AC': ['ao', 'ac'],
  'Gator': ['alligator', 'gator'],
  'MFI': ['mfi'],
  'Zonas de Williams': ['zones'],
  'Tres sabios': ['wise']
};

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

const Colors = ({ items }) => (
  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
    {items.map(([label, value, onChange]) => (
      <div className="setting-row" key={label}>
        <label>{label}</label>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    ))}
  </div>
);

/**
 * Ajustes de los indicadores de Bill Williams. Es una sola configuración para los ocho (los comparten: la AC usa el
 * AO; el Gator, las zonas y los tres sabios usan el Alligator): cada indicador abre aquí sus secciones. Aplica a todos
 * los marcos del símbolo
 */
const WilliamsSettings = ({ symbol, indicator, which, onApply, onClose }) => {
  const [values, setValues] = useState(() => copy(indicator.config));
  const set = (section, key, value) => setValues(previous => ({ ...previous, [section]: { ...previous[section], [key]: value } }));
  const sections = SECTIONS[which] || Object.keys(defaultWilliamsConfig());
  const a = values.alligator;
  const f = values.fractals;
  const ao = values.ao;
  const ac = values.ac;
  const g = values.gator;
  const m = values.mfi;
  const z = values.zones;
  const w = values.wise;

  const handleApply = () => {
    const settings = cleanWilliamsSettings(values);
    saveWilliamsSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  const reset = () => {
    const base = defaultWilliamsConfig();
    setValues(previous => ({ ...previous, ...Object.fromEntries(sections.map(section => [section, base[section]])) }));
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>{which} - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          {sections.includes('alligator') && (
            <div className="settings-section">
              <h4>Alligator{which === 'Gator' ? ' (el Gator usa sus líneas)' : ''}</h4>
              <span className="hint">Medias suavizadas del precio medio (H+L)/2, desplazadas a la derecha. Los del libro: 13/8, 8/5 y 5/3.</span>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <NumberRow label="Mandíbula: velas" value={a.jawLen} min={2} max={200} onChange={(v) => set('alligator', 'jawLen', v)} />
                <NumberRow label="desplazada" value={a.jawShift} min={0} max={50} onChange={(v) => set('alligator', 'jawShift', v)} />
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <NumberRow label="Dientes: velas" value={a.teethLen} min={2} max={200} onChange={(v) => set('alligator', 'teethLen', v)} />
                <NumberRow label="desplazados" value={a.teethShift} min={0} max={50} onChange={(v) => set('alligator', 'teethShift', v)} />
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <NumberRow label="Labios: velas" value={a.lipsLen} min={2} max={200} onChange={(v) => set('alligator', 'lipsLen', v)} />
                <NumberRow label="desplazados" value={a.lipsShift} min={0} max={50} onChange={(v) => set('alligator', 'lipsShift', v)} />
              </div>
              {which === 'Alligator' && (
                <>
                  <NumberRow label="Abertura mínima para decir que está despierto (ATR)" value={a.sleepAtr} min={0} max={10} step={0.1} onChange={(v) => set('alligator', 'sleepAtr', v)}
                    hint="Con las líneas más juntas que esto, o fuera de orden, duerme." />
                  <Check label="Proyección: las líneas siguen a la derecha de la última vela" checked={a.projection} onChange={(v) => set('alligator', 'projection', v)}
                    hint="Es lo que ya se sabe: el valor de velas cerradas, desplazado." />
                  <Check label="Tira bajo las velas: despierto al alza, a la baja o dormido" checked={a.showState} onChange={(v) => set('alligator', 'showState', v)} />
                  <NumberRow label="Grosor de las líneas" value={a.width} min={0.5} max={4} step={0.5} onChange={(v) => set('alligator', 'width', v)} />
                  <Colors items={[['Mandíbula', a.jawColor, (v) => set('alligator', 'jawColor', v)], ['Dientes', a.teethColor, (v) => set('alligator', 'teethColor', v)], ['Labios', a.lipsColor, (v) => set('alligator', 'lipsColor', v)]]} />
                </>
              )}
            </div>
          )}

          {sections.includes('fractals') && (
            <div className="settings-section">
              <h4>Fractales</h4>
              <span className="hint">Un máximo con dos máximos menores a cada lado (un mínimo, al revés). Se sabe al cerrar la segunda vela menor de su derecha.</span>
              <Check label="Fractales de máximo" checked={f.showUp} onChange={(v) => set('fractals', 'showUp', v)} />
              <Check label="Fractales de mínimo" checked={f.showDown} onChange={(v) => set('fractals', 'showDown', v)} />
              <Check label="En gris los que se supieron dentro de la boca del Alligator" checked={f.alligatorFilter} onChange={(v) => set('fractals', 'alligatorFilter', v)}
                hint="Del lado equivocado de los dientes: el libro no los opera." />
              <NumberRow label="Velas a la derecha para confirmar con máximos iguales" value={f.maxRight} min={2} max={100} onChange={(v) => set('fractals', 'maxRight', v)} />
              <Colors items={[['Máximo', f.upColor, (v) => set('fractals', 'upColor', v)], ['Mínimo', f.downColor, (v) => set('fractals', 'downColor', v)]]} />
            </div>
          )}

          {sections.includes('ao') && (
            <div className="settings-section">
              <h4>Awesome Oscillator (AO){which === 'AC' ? ': la AC usa este AO' : ''}</h4>
              <span className="hint">Media simple del precio medio de las últimas velas menos la de más velas. Los del libro: 5 y 34.</span>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <NumberRow label="Rápida (velas)" value={ao.fast} min={1} max={200} onChange={(v) => set('ao', 'fast', v)} />
                <NumberRow label="Lenta (velas)" value={ao.slow} min={2} max={500} onChange={(v) => set('ao', 'slow', v)} />
              </div>
              {which === 'AO' && (
                <>
                  <Check label="Punto en la tercera barra seguida del mismo color (2.º sabio)" checked={ao.showSuper} onChange={(v) => set('ao', 'showSuper', v)} />
                  <Colors items={[['Sube', ao.upColor, (v) => set('ao', 'upColor', v)], ['Baja', ao.downColor, (v) => set('ao', 'downColor', v)]]} />
                </>
              )}
            </div>
          )}

          {sections.includes('ac') && (
            <div className="settings-section">
              <h4>Accelerator (AC)</h4>
              <NumberRow label="Media del AO que se resta (velas)" value={ac.signal} min={1} max={200} onChange={(v) => set('ac', 'signal', v)} hint="La de siempre: 5." />
              <Colors items={[['Sube', ac.upColor, (v) => set('ac', 'upColor', v)], ['Baja', ac.downColor, (v) => set('ac', 'downColor', v)]]} />
            </div>
          )}

          {sections.includes('gator') && (
            <div className="settings-section">
              <h4>Gator Oscillator</h4>
              <span className="hint">Arriba, la distancia entre la mandíbula y los dientes; abajo, entre los dientes y los labios. Verde si crece, roja si se achica.</span>
              <Colors items={[['Crece', g.upColor, (v) => set('gator', 'upColor', v)], ['Se achica', g.downColor, (v) => set('gator', 'downColor', v)]]} />
            </div>
          )}

          {sections.includes('mfi') && (
            <div className="settings-section">
              <h4>Market Facilitation Index (MFI)</h4>
              <span className="hint">(máximo − mínimo) ÷ volumen, comparado con la vela anterior. La vela en formación no lleva MFI: su volumen sigue creciendo.</span>
              <Check label="Marcar los squats bajo las velas" checked={m.squatOnPrice} onChange={(v) => set('mfi', 'squatOnPrice', v)}
                hint="Baja el MFI y sube el volumen: mucho volumen que no mueve el precio." />
              <Colors items={[['Verde', m.green, (v) => set('mfi', 'green', v)], ['Fade', m.fade, (v) => set('mfi', 'fade', v)], ['Fake', m.fake, (v) => set('mfi', 'fake', v)], ['Squat', m.squat, (v) => set('mfi', 'squat', v)]]} />
            </div>
          )}

          {sections.includes('zones') && (
            <div className="settings-section">
              <h4>Zonas de Williams</h4>
              <span className="hint">Verde con el AO y el AC subiendo, roja con los dos bajando, gris lo demás. Usan el AO y el AC de sus secciones.</span>
              <div className="setting-row">
                <label>Cómo se muestran</label>
                <select value={z.mode} onChange={(e) => set('zones', 'mode', e.target.value)}>
                  <option value="candles">Colorear las velas</option>
                  <option value="strip">Tira arriba del gráfico</option>
                </select>
                <span className="hint">Con los footprints a la vista se usa la tira.</span>
              </div>
              <Colors items={[['Verde', z.green, (v) => set('zones', 'green', v)], ['Roja', z.red, (v) => set('zones', 'red', v)], ['Gris', z.gray, (v) => set('zones', 'gray', v)]]} />
            </div>
          )}

          {sections.includes('wise') && (
            <div className="settings-section">
              <h4>Tres sabios</h4>
              <Check label="1.º: barra divergente lejos de la boca, con angulación" checked={w.first} onChange={(v) => set('wise', 'first', v)} />
              <div style={{ paddingLeft: '18px' }}>
                <NumberRow label="Mínimo más bajo que las velas anteriores" value={w.lookback} min={1} max={20} onChange={(v) => set('wise', 'lookback', v)} hint="El libro compara con la anterior: 1." />
                <NumberRow label="Angulación: velas hacia atrás" value={w.angBars} min={1} max={50} onChange={(v) => set('wise', 'angBars', v)}
                  hint="El hueco entre la mandíbula y la vela tiene que haber crecido en estas velas." />
                <NumberRow label="Hueco mínimo con la mandíbula (ATR)" value={w.minGapAtr} min={0} max={10} step={0.1} onChange={(v) => set('wise', 'minGapAtr', v)} hint="0: basta con quedar entera fuera de las tres líneas." />
                <Check label="Con el AO en contra (rojo en la alcista)" checked={w.requireAo} onChange={(v) => set('wise', 'requireAo', v)} />
              </div>
              <Check label="2.º: tercera barra seguida del mismo color del AO" checked={w.second} onChange={(v) => set('wise', 'second', v)} />
              <NumberRow label="Velas que espera la entrada stop de los sabios 1 y 2" value={w.pendingBars} min={1} max={100} onChange={(v) => set('wise', 'pendingBars', v)}
                hint="Se cancela antes si el precio toca su stop." />
              <Check label="3.º: ruptura del último fractal de su lado" checked={w.third} onChange={(v) => set('wise', 'third', v)} />
              <div style={{ paddingLeft: '18px' }}>
                <Check label="Solo del lado correcto de los dientes al romperlo" checked={w.alligatorFilter} onChange={(v) => set('wise', 'alligatorFilter', v)} />
              </div>
              <Check label="Línea de la entrada stop" checked={w.showEntries} onChange={(v) => set('wise', 'showEntries', v)} />
              <Check label="Línea del stop inicial" checked={w.showStops} onChange={(v) => set('wise', 'showStops', v)} />
              <Colors items={[['Alcista', w.upColor, (v) => set('wise', 'upColor', v)], ['Bajista', w.downColor, (v) => set('wise', 'downColor', v)]]} />
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={reset}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default WilliamsSettings;
