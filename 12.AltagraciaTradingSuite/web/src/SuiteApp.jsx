import React, { useEffect, useState } from 'react';
import { useUiTheme } from '@app1/components/useUiTheme.js';
import ThemeSettings from '@app1/components/ThemeSettings.jsx';
import ChartView from './ChartView.jsx';
import BotView from './BotView.jsx';
import { getJson } from './api.js';

const MODULES = [
  { id: 'chart', label: 'Gráfico' },
  { id: 'bot', label: 'Bot' },
];

const loadModule = () => {
  try {
    return localStorage.getItem('suite_module') || 'chart';
  } catch {
    return 'chart';
  }
};

const dayText = (day) => (day ? day.split('-').reverse().slice(0, 2).join('/') : '—');

/** Barra inferior: de donde salen los datos y si el bot responde */
function StatusBar() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () => getJson('/api/suite/status').then(s => alive && setStatus(s)).catch(() => alive && setStatus(null));
    read();
    const timer = setInterval(read, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!status) return <div className="suite-status"><span><span className="suite-dot bad" />Servidor de la suite sin respuesta</span></div>;
  const btc = status.store?.BTCUSDT || {};
  const tape = status.local_tape || {};
  const bot = status.bot || {};
  return (
    <div className="suite-status">
      <span title="Último día oficial de Bybit en el almacén de BTC">Almacén oficial BTC hasta {dayText(btc.official_last)}</span>
      <span title="Días armados con la nube y el PC (OrderFlowData/live)">Días en vivo: {btc.live_days?.length ? btc.live_days.map(dayText).join(', ') : 'ninguno'}</span>
      <span title="Grabación de trades del backend 11000">
        <span className={`suite-dot ${tape.running ? 'ok' : tape.running === false ? 'bad' : ''}`} />
        Grabación local {tape.running ? `(${tape.symbols} monedas)` : tape.running === false ? 'apagada' : 'sin respuesta del 11000'}
      </span>
      <span>
        <span className={`suite-dot ${bot.online ? 'ok' : 'bad'}`} />
        Bot {bot.online ? `${bot.mode || ''}${bot.trading_paused ? ' · en pausa' : ''}` : 'sin respuesta'}
      </span>
    </div>
  );
}

export default function SuiteApp() {
  useUiTheme();
  const [module, setModule] = useState(loadModule);
  const [showTheme, setShowTheme] = useState(false);

  const choose = (id) => {
    setModule(id);
    try { localStorage.setItem('suite_module', id); } catch { /* sin almacenamiento */ }
  };

  return (
    <div className="suite-root">
      <div className="suite-bar">
        <span className="suite-title">Altagracia Trading Suite</span>
        {MODULES.map(m => (
          <button key={m.id} type="button" className={`suite-btn ${module === m.id ? 'active' : ''}`} onClick={() => choose(m.id)}>
            {m.label}
          </button>
        ))}
        <div className="suite-spacer" />
        <button type="button" className="suite-btn" onClick={() => setShowTheme(true)}>Estilo</button>
      </div>
      <div className="suite-main">
        {/* Los dos módulos quedan montados: cambiar de pestaña no recarga el gráfico */}
        <div style={{ position: 'absolute', inset: 0, display: module === 'chart' ? 'block' : 'none' }}>
          <ChartView active={module === 'chart'} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: module === 'bot' ? 'block' : 'none' }}>
          <BotView active={module === 'bot'} />
        </div>
      </div>
      <StatusBar />
      {showTheme && <ThemeSettings onClose={() => setShowTheme(false)} />}
    </div>
  );
}
