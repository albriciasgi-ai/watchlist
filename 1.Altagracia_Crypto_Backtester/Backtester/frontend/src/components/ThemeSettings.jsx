// Modal "Estilo y colores": elige el estilo (Nítido, Oscuro, Personalizado, Muhammad o el aspecto clásico) y cambia
// los colores del estilo activo. Nítido no cambia; Oscuro, Personalizado y Muhammad guardan cada uno lo suyo.
// Los cambios se ven al instante y quedan guardados (uiTheme.js).
import React, { useEffect } from 'react';
import {
  COLOR_GROUPS, STYLES, contrast, isNewTheme, resetThemeColors, setTheme, setThemeColors, themeBaseColors, themeColors,
  themeEditable, themeName
} from './uiTheme.js';
import { useUiTheme } from './useUiTheme.js';
import { Icon } from './uiIcons.jsx';
import './ThemeSettings.css';

// Colores de datos que se pierden sobre el fondo si se acercan mucho a él
const ON_CHART = new Set(['up', 'down', 'fpBuy', 'fpSell', 'fpPoc', 'vpPoc', 'crosshair', 'oiUp', 'oiDown', 'divergence', 'text']);

export default function ThemeSettings({ onClose }) {
  useUiTheme();
  const colors = themeColors();
  const base = themeBaseColors();
  const active = themeName();
  const editable = themeEditable();
  const activeName = STYLES.find(style => style.id === active)?.name || 'Nítido';
  // Personalizado parte de Nítido: sus colores vuelven a los de Nítido; los demás, a los de su estilo
  const baseName = active === 'personalizado' ? 'Nítido' : activeName;
  const changedCount = editable ? Object.keys(colors).filter(key => colors[key].toUpperCase() !== base[key].toUpperCase()).length : 0;

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
          {STYLES.map(style => (
            <label key={style.id} className={`ts-style ${active === style.id ? 'on' : ''}`}>
              <input type="radio" name="ui-style" checked={active === style.id} onChange={() => setTheme(style.id)} />
              <span>
                <strong>{style.name}</strong>
                <small>{style.text}</small>
              </span>
            </label>
          ))}
        </section>

        {isNewTheme() && !editable && (
          <p className="ts-note">Los colores de {activeName} son fijos. Para cambiar colores elige Oscuro, Personalizado o Muhammad: cada uno guarda lo que cambies.</p>
        )}

        <section className={`ts-colors ${editable ? '' : 'disabled'}`} aria-disabled={!editable}>
          {COLOR_GROUPS.map(group => (
            <div className="ts-group" key={group.title}>
              <h4>{group.title}</h4>
              {group.fields.map(([key, label]) => {
                const value = colors[key].toUpperCase();
                const isDefault = value === base[key].toUpperCase();
                const faint = ON_CHART.has(key) && contrast(value, colors.chartBg) < 1.8;
                return (
                  <div className="ts-field" key={key}>
                    <input
                      type="color"
                      value={value.toLowerCase()}
                      disabled={!editable}
                      onChange={event => setThemeColors({ [key]: event.target.value })}
                      aria-label={`${group.title}: ${label}`}
                    />
                    <span className="ts-label">
                      {label}
                      {faint && <em className="ts-hint">casi no se ve sobre el fondo</em>}
                    </span>
                    {editable && !isDefault && (
                      <button className="ts-undo" onClick={() => setThemeColors({ [key]: base[key] })} title={`Volver al color de ${baseName}`}>
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
          <button className="ts-reset" disabled={!editable || changedCount === 0} onClick={resetThemeColors}>
            Volver a los colores de {baseName}{changedCount > 0 ? ` (${changedCount} ${changedCount === 1 ? 'cambiado' : 'cambiados'})` : ''}
          </button>
          <button className="ts-done" onClick={onClose}>Listo</button>
        </footer>
      </div>
    </div>
  );
}
