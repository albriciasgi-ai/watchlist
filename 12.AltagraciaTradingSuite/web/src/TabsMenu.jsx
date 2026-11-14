import React, { useEffect, useRef, useState } from 'react';
import { MAX_TABS, TAB, openTab } from './tabs.js';

const MODULE_LABELS = [['chart', 'Gráfico'], ['watchlist', 'Watchlist'], ['journal', 'Journal'], ['bot', 'Bot'], ['mapa', 'Mapa']];

/**
 * Menú "Pestañas" (13/11/2026): abre de la 2 a la 5 con el módulo que se elija (en Electron, otra ventana) o cambia el
 * módulo de esta. Varias pestañas con el gráfico dan varias monedas con su gráfico completo a la vez. La 1 es la
 * ventana principal: desde otra no se abre de nuevo, para no tener dos que tomen las imágenes del journal.
 * onModule(module) cambia el módulo de esta pestaña.
 */
export default function TabsMenu({ onModule, buttonClass = 'suite-btn', children = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const go = (n, module) => {
    setOpen(false);
    if (n === TAB) onModule?.(module);
    else openTab(n, module);
  };
  return (
    <div className="tabs-menu-anchor" ref={ref}>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen(v => !v)}
        title="Abrir otra pestaña con el gráfico, la Watchlist, el journal, el bot o el mapa de liquidez"
      >
        {children || 'Pestañas'}
      </button>
      {open && (
        <div className="suite-menu tabs-menu">
          {Array.from({ length: MAX_TABS }, (_, i) => i + 1).map(n => (
            <div key={n} className="tabs-menu-row">
              <span className="tabs-menu-name">{n === TAB ? `Pestaña ${n} (esta)` : `Pestaña ${n}`}</span>
              {n === 1 && TAB !== 1
                ? <span className="wl-muted">la ventana principal</span>
                : MODULE_LABELS.map(([module, label]) => (
                  <button key={module} type="button" className="suite-btn" onClick={() => go(n, module)}>{label}</button>
                ))}
            </div>
          ))}
          <div className="wl-muted tabs-menu-note">
            Cada pestaña tiene su moneda y sus marcos. Usa los indicadores de la 1 hasta que cambies uno en ella, y los
            dibujos son los mismos en todas. Solo la 1 toma las imágenes del journal y da los avisos de Windows.
          </div>
        </div>
      )}
    </div>
  );
}
