// Modal "Estilo y colores": elige entre Nítido y el aspecto clásico y cambia cada color de Nítido.
// Los cambios se ven al instante y quedan guardados (uiTheme.js).
import React, { useEffect } from 'react';
import {
  COLOR_GROUPS, DEFAULT_COLORS, contrast, isNewTheme, resetThemeColors, setTheme, setThemeColors, themeColors
} from './uiTheme.js';
import { useUiTheme } from './useUiTheme.js';
import { Icon } from './uiIcons.jsx';
import './ThemeSettings.css';

// Colores de datos que se pierden sobre el fondo si se acercan mucho a él
const ON_CHART = new Set(['up', 'down', 'fpBuy', 'fpSell', 'fpPoc', 'vpPoc', 'crosshair', 'oiUp', 'oiDown', 'divergence', 'text']);

export default function ThemeSettings({ onClose }) {
  useUiTheme();
  const colors = themeColors();
  const nitido = isNewTheme();
  const changedCount = Object.keys(colors).filter(key => colors[key].toUpperCase() !== DEFAULT_COLORS[key]).length;

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="theme-settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="theme-settings" role="dialog" aria-label="Estilo y colores">
        <header>
          <h3>Estilo y colores</h3>
          <button className="ts-close" onClick={onClose} title="Cerrar (Esc)"><Icon name="close" size={16} /></button>
        </header>

        <section className="ts-styles">
          <label className={`ts-style ${nitido ? 'on' : ''}`}>
            <input type="radio" name="ui-style" checked={nitido} onChange={() => setTheme('nitido')} />
            <span>
              <strong>Nítido</strong>
              <small>Una sola letra, color solo en los datos, ejes con números redondos y footprint graduado por volumen. Sus colores se cambian abajo.</small>
            </span>
          </label>
          <label className={`ts-style ${nitido ? '' : 'on'}`}>
            <input type="radio" name="ui-style" checked={!nitido} onChange={() => setTheme('clasico')} />
            <span>
              <strong>Clásico</strong>
              <small>El aspecto anterior de App 1, sin ningún cambio.</small>
            </span>
          </label>
        </section>

        <section className={`ts-colors ${nitido ? '' : 'disabled'}`} aria-disabled={!nitido}>
          {COLOR_GROUPS.map(group => (
            <div className="ts-group" key={group.title}>
              <h4>{group.title}</h4>
              {group.fields.map(([key, label]) => {
                const value = colors[key].toUpperCase();
                const isDefault = value === DEFAULT_COLORS[key];
                const faint = ON_CHART.has(key) && contrast(value, colors.chartBg) < 1.8;
                return (
                  <div className="ts-field" key={key}>
                    <input
                      type="color"
                      value={value.toLowerCase()}
                      disabled={!nitido}
                      onChange={event => setThemeColors({ [key]: event.target.value })}
                      aria-label={`${group.title}: ${label}`}
                    />
                    <span className="ts-label">
                      {label}
                      {faint && <em className="ts-hint">casi no se ve sobre el fondo</em>}
                    </span>
                    {!isDefault && (
                      <button className="ts-undo" disabled={!nitido} onClick={() => setThemeColors({ [key]: DEFAULT_COLORS[key] })} title="Volver al color de Nítido">
                        <Icon name="undo" size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <footer>
          <button className="ts-reset" disabled={!nitido || changedCount === 0} onClick={resetThemeColors}>
            Restablecer los colores de Nítido{changedCount > 0 ? ` (${changedCount} ${changedCount === 1 ? 'cambiado' : 'cambiados'})` : ''}
          </button>
          <button className="ts-done" onClick={onClose}>Listo</button>
        </footer>
      </div>
    </div>
  );
}
