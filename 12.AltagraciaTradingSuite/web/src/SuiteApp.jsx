import React, { useState } from 'react';
import { useUiTheme } from '@app1/components/useUiTheme.js';
import ThemeSettings from '@app1/components/ThemeSettings.jsx';
import ChartView from './ChartView.jsx';
import WatchlistView from './WatchlistView.jsx';
import BotView from './BotView.jsx';
import BotConfig from './BotConfig.jsx';
import JournalView from './JournalView.jsx';
import TabsMenu from './TabsMenu.jsx';
import { MODULE_PARAM, TAB, tabUrl } from './tabs.js';
import { useBotNotifications } from './botNotifications.js';

const MODULE_KEY = `suite_module_${TAB}`;
const loadModule = () => {
  try {
    return localStorage.getItem(MODULE_KEY) || 'chart';
  } catch {
    return 'chart';
  }
};
const saveModule = (id) => {
  try { localStorage.setItem(MODULE_KEY, id); } catch { /* sin almacenamiento */ }
};

// Una pestaña abierta desde el menú "Pestañas" llega con su módulo en la dirección (?modulo=...): se toma y se guarda,
// y la dirección queda sin él para que recargar no la devuelva a ese módulo si después se cambió
const START = (() => {
  if (!MODULE_PARAM) return { module: loadModule(), botSection: 'status' };
  const start = MODULE_PARAM === 'journal' ? { module: 'bot', botSection: 'journal' } : { module: MODULE_PARAM, botSection: 'status' };
  saveModule(start.module);
  try { window.history.replaceState(null, '', tabUrl(TAB)); } catch { /* sin historial */ }
  return start;
})();

export default function SuiteApp() {
  useUiTheme();
  useBotNotifications();
  const [module, setModule] = useState(START.module);
  const [botSection, setBotSection] = useState(START.botSection);
  const [showTheme, setShowTheme] = useState(false);
  const [focusTrade, setFocusTrade] = useState(null); // "Ver en el gráfico" desde el journal
  const [focusSymbol, setFocusSymbol] = useState(null); // una moneda de la Watchlist
  // La Watchlist se arma la primera vez que se abre y después queda armada: sus gráficos no se pausan
  const [watchlistOn, setWatchlistOn] = useState(START.module === 'watchlist');

  const choose = (id) => {
    if (id === 'watchlist') setWatchlistOn(true);
    setModule(id);
    saveModule(id);
  };
  // Desde el menú "Pestañas" para esta misma pestaña: el journal es una sección del bot
  const openModule = (name) => {
    if (name === 'journal' || name === 'bot') {
      setBotSection(name === 'journal' ? 'journal' : 'status');
      choose('bot');
    } else {
      choose(name);
    }
  };
  const openChart = (symbol, tf) => {
    setFocusSymbol({ symbol, tf, at: Date.now() });
    choose('chart');
  };

  return (
    <>
      {/* Los módulos quedan montados: volver al gráfico o a la Watchlist no los recarga */}
      <div style={{ display: module === 'chart' ? 'block' : 'none' }}>
        <ChartView
          active={module === 'chart'}
          onOpenBot={() => choose('bot')}
          onOpenTheme={() => setShowTheme(true)}
          onOpenWatchlist={() => choose('watchlist')}
          onModule={openModule}
          focusTrade={focusTrade}
          focusSymbol={focusSymbol}
        />
      </div>
      {watchlistOn && (
        <div style={{ display: module === 'watchlist' ? 'block' : 'none' }}>
          <WatchlistView
            active={module === 'watchlist'}
            onOpenChart={openChart}
            onBack={() => choose('chart')}
            onOpenTheme={() => setShowTheme(true)}
            onModule={openModule}
          />
        </div>
      )}
      {module === 'bot' && (
        <div className="suite-root">
          <div className="suite-bar">
            <button type="button" className="suite-btn" onClick={() => choose('chart')}>← Gráfico</button>
            <button type="button" className="suite-btn" onClick={() => choose('watchlist')}>Watchlist</button>
            <span className="suite-title">Bot{TAB > 1 ? ` · pestaña ${TAB}` : ''}</span>
            {[['status', 'Estado'], ['journal', 'Journal'], ['config', 'Configuración y riesgo']].map(([id, label]) => (
              <button key={id} type="button" className={`suite-btn ${botSection === id ? 'active' : ''}`} onClick={() => setBotSection(id)}>{label}</button>
            ))}
            <div className="suite-spacer" />
            <TabsMenu onModule={openModule} />
            <button type="button" className="suite-btn" onClick={() => setShowTheme(true)}>Estilo</button>
          </div>
          <div className="suite-main">
            {botSection === 'status' && <BotView active />}
            {botSection === 'journal' && (
              <div className="bot-view">
                <JournalView active onShowTrade={(t) => { setFocusTrade({ ...t, requestedAt: Date.now() }); choose('chart'); }} />
              </div>
            )}
            {botSection === 'config' && <div className="bot-view"><BotConfig active /></div>}
          </div>
        </div>
      )}
      {showTheme && <ThemeSettings onClose={() => setShowTheme(false)} />}
    </>
  );
}
