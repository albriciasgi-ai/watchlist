import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { VPA_CODES, VPA_GLYPHS, VPA_LIMITS, cleanVpaConfig, defaultVpaConfig, saveVpaSettings } from './indicators/vpa.js';

/** Ajustes del Lector VPA. Aplica a todos los marcos del símbolo. */
const VPASettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => cleanVpaConfig(indicator.config));
  const setParam = (key, value) => setValues(previous => ({ ...previous, params: { ...previous.params, [key]: value } }));
  const setPair = (key, at, value) => setValues(previous => {
    const pair = [...previous.params[key]];
    pair[at] = value;
    return { ...previous, params: { ...previous.params, [key]: pair } };
  });
  const setShow = (key, value) => setValues(previous => ({ ...previous, show: { ...previous.show, [key]: value } }));

  const handleApply = () => {
    const settings = cleanVpaConfig({ ...values, params: { ...values.params, volLow: values.params.volLow.map(Number), volHigh: values.params.volHigh.map(Number), volUltra: values.params.volUltra.map(Number), spreadWide: values.params.spreadWide.map(Number) } });
    saveVpaSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  const number = (key, label, step, hint) => (
    <div className="setting-row">
      <label>{label}</label>
      <input type="number" min={VPA_LIMITS[key][0]} max={VPA_LIMITS[key][1]} step={step} value={values.params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );

  const pair = (key, label, hint) => (
    <div className="setting-row">
      <label>{label}</label>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="number" step={0.05} min={0.05} style={{ width: 70 }} value={values.params[key][0]} onChange={(e) => setPair(key, 0, e.target.value)} />
        <span>a</span>
        <input type="number" step={0.05} min={0.05} style={{ width: 70 }} value={values.params[key][1]} onChange={(e) => setPair(key, 1, e.target.value)} />
        <span>veces lo normal</span>
      </span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );

  const check = (key, label) => (
    <label className="checkbox-label" style={{ display: 'block', marginBottom: 6 }}>
      <input type="checkbox" checked={!!values.show[key]} onChange={(e) => setShow(key, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Lector VPA - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Qué es</h4>
            <span className="hint" style={{ display: 'block' }}>
              El Volume Price Analysis de Anna Coulling con reglas propias. Cada vela se compara con lo normal de su misma hora en los días anteriores
              (volumen y rango); en los elementos, un volumen alto lo es también frente a las 20 velas anteriores, y una vela ancha con volumen alto es
              esfuerzo con resultado. Cada lectura es un grado de 0 a
              100%: esfuerzo sin resultado (mucho volumen, poco rango), resultado sin esfuerzo
              (mucho rango, poco volumen), estrella, martillo, hanging man, doji y esfuerzo que se agota. Todas suman evidencia a un medidor que se
              desvanece vela a vela: arriba de cero es fuerza, abajo debilidad. Ninguna vela decide sola, como pide el libro.
            </span>
          </div>

          <div className="settings-section">
            <h4>Lo normal y el tramo</h4>
            {number('days', 'Días que se comparan', 1, 'Mediana de esa misma hora en estos días. En 1D, de los días anteriores.')}
            {number('minDays', 'Días mínimos', 1, 'Antes de tenerlos la vela no se lee.')}
            {number('legAtr', 'Giro del tramo (ATR)', 0.5, 'El tramo cambia cuando un cierre se aleja esto de su extremo (como el Volumen de Respuesta).')}
          </div>

          <div className="settings-section">
            <h4>Grados</h4>
            {pair('volLow', 'Volumen bajo: de 100% hasta 0%', 'Debajo del primero es bajo del todo; desde el segundo, ya no.')}
            {pair('volHigh', 'Volumen alto: de 0% a 100%', null)}
            {pair('volUltra', 'Volumen ultra alto: de 0% a 100%', null)}
            {pair('spreadWide', 'Rango ancho: de 0% a 100%', null)}
            {number('fire', 'Un elemento cuenta desde (grado)', 0.05, 'De 0.1 a 1. Con 0.5 basta medio camino en cada rampa.')}
            {number('decay', 'Memoria del medidor', 0.05, 'Lo que queda de la evidencia en la vela siguiente (0.75: a las 3 velas queda menos de la mitad).')}
            {number('meter', 'Umbral del medidor', 0.1, 'Líneas punteadas del panel y elemento «Medidor cruza el umbral».')}
          </div>

          <div className="settings-section">
            <h4>Elementos</h4>
            {number('rangeBars', 'Ruptura: rango de las velas anteriores', 1, 'El primer cierre fuera del máximo o el mínimo de estas velas.')}
            {number('maxRangeAtr', 'Ruptura: alto máximo del rango (ATR)', 0.5, 'Un rango más alto no es congestión.')}
            {number('pullBars', 'Retroceso: velas tras la ruptura', 1, null)}
            {number('testLook', 'Prueba: velas con mucho volumen contrario', 1, 'La prueba entra a una zona donde hubo mucho volumen del otro lado.')}
            {number('stopBars', 'Frenado o techo: velas', 1, '2 de estas velas con mecha contra el tramo y volumen alto.')}
            {number('climaxBars', 'Clímax: velas', 1, '2 o más con volumen ultra alto y mecha contra el tramo, al mismo precio.')}
          </div>

          <div className="settings-section">
            <h4>Qué se dibuja</h4>
            {check('meter', 'Medidor en el panel')}
            {check('marks', 'Elementos sobre las velas (verde: fuerza, rojo: debilidad; más opaco, más grado)')}
            {check('widthByVolume', 'Velas con ancho por volumen (más ancha, más volumen frente a lo normal de su hora; la de siempre es el volumen normal)')}
            <div style={{ columns: 2 }}>
              {Object.entries(VPA_CODES).map(([code, name]) => <div key={code} title={code}>{check(code, `${name} (${VPA_GLYPHS[code]})`)}</div>)}
            </div>
          </div>

          <div className="settings-section">
            <h4>Medido (fase 1, hasta 2023)</h4>
            <span className="hint" style={{ display: 'block' }}>
              Con el delta real de seis monedas: en las velas de esfuerzo sin resultado el lado contrario al color pesa más que en velas parecidas
              (la lectura del libro se confirma), y en una estrella con volumen alto pesan más los compradores agresivos: son ellos los que quedan atrapados.
              Por el probador, en 4h y siete monedas: la ruptura con volumen da +0.12 a +0.14 R por trade sobre los controles al azar, en el borde de su margen;
              el esfuerzo sin resultado no anticipa el giro (seguir el color de la vela rinde más), y la prueba de poco volumen y el cruce del medidor pierden.
              Es una ayuda de lectura, no una señal.
            </span>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultVpaConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default VPASettings;
