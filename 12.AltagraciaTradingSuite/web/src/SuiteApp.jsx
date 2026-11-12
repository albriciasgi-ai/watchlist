import React, { useState } from 'react';
import { useUiTheme } from '@app1/components/useUiTheme.js';
import ThemeSettings from '@app1/components/ThemeSettings.jsx';
import ChartView from './ChartView.jsx';
import BotView from './BotView.jsx';
import BotConfig from './BotConfig.jsx';
import JournalView from './JournalView.jsx';
import { TAB } from './tabs.js';
import { useBotNotifications } from './botNotifications.js';

const MODULE_KEY = `suite_module_${TAB}`;
const loadModule = () => {
  try {
    return localStorage.getItem(MODULE_KEY) || 'chart';
  } catch {
    return 'chart';
  }
};

export default function SuiteApp() {
  useUiTheme();
  useBotNotifications();
  const [module, setModule] = useState(loadModule);
  const [botSection, setBotSection] = useState('status');
  const [showTheme, setShowTheme] = useState(false);

  const choose = (id) => {
    setModule(id);
    try { localStorage.setItem(MODULE_KEY, id); } catch { /* sin almacenamiento */ }
  };

  return (
    <>
      {/* Los dos modulos quedan montados: volver al grafico no lo recarga */}
      <div style={{ display: module === 'chart' ? 'block' : 'none' }}>
        <ChartView active={module === 'chart'} onOpenBot={() => choose('bot')} onOpenTheme={() => setShowTheme(true)} />
      </div>
      {module === 'bot' && (
        <div className="suite-root">
          <div className="suite-bar">
            <button type="button" className="suite-btn" onClick={() => choose('chart')}>← Gráfico</button>
            <span className="suite-title">Bot</span>
            {[['status', 'Estado'], ['journal', 'Journal'], ['config', 'Configuración y riesgo']].map(([id, label]) => (
              <button key={id} type="button" className={`suite-btn ${botSection === id ? 'active' : ''}`} onClick={() => setBotSection(id)}>{label}</button>
            ))}
            <div className="suite-spacer" />
            <button type="button" className="suite-btn" onClick={() => setShowTheme(true)}>Estilo</button>
          </div>
          <div className="suite-main">
            {botSection === 'status' && <BotView active />}
            {botSection === 'journal' && <div className="bot-view"><JournalView active /></div>}
            {botSection === 'config' && <div className="bot-view"><BotConfig active /></div>}
          </div>
        </div>
      )}
      {showTheme && <ThemeSettings onClose={() => setShowTheme(false)} />}
    </>
  );
}
