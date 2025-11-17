import React, { useState } from 'react';
import Watchlist from './components/Watchlist';
import BacktestingApp from './components/backtesting/BacktestingApp';
import './app_navigation.css';

const App = () => {
  const [activeModule, setActiveModule] = useState('watchlist'); // 'watchlist' or 'backtesting'

  return (
    <div className="app-container">
      <nav className="app-navigation">
        <div className="nav-brand">
          <span className="nav-logo">📊</span>
          <span className="nav-title">Crypto Trading Tools</span>
        </div>

        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeModule === 'watchlist' ? 'active' : ''}`}
            onClick={() => setActiveModule('watchlist')}
          >
            <span className="tab-icon">👁️</span>
            <span className="tab-label">Watchlist</span>
          </button>

          <button
            className={`nav-tab ${activeModule === 'backtesting' ? 'active' : ''}`}
            onClick={() => setActiveModule('backtesting')}
          >
            <span className="tab-icon">⏮️</span>
            <span className="tab-label">Backtesting</span>
          </button>
        </div>

        <div className="nav-info">
          <span className="nav-status">
            {activeModule === 'watchlist' ? 'Tiempo Real' : 'Histórico'}
          </span>
        </div>
      </nav>

      <div className="app-content">
        {activeModule === 'watchlist' && <Watchlist />}
        {activeModule === 'backtesting' && <BacktestingApp />}
      </div>
    </div>
  );
};

export default App;
