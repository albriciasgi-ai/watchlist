import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import Watchlist from "./components/Watchlist";
import BacktestingApp from "./components/backtesting/BacktestingApp";
import "./styles.css";
import "./volume_profile_styles.css";

const App = () => {
  const [currentView, setCurrentView] = useState('watchlist'); // 'watchlist' or 'backtesting'

  return (
    <div>
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '50px',
        backgroundColor: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '10px',
        zIndex: 1000,
        borderBottom: '2px solid #333'
      }}>
        <button
          onClick={() => setCurrentView('watchlist')}
          style={{
            padding: '8px 16px',
            backgroundColor: currentView === 'watchlist' ? '#4CAF50' : '#444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: currentView === 'watchlist' ? 'bold' : 'normal'
          }}
        >
          📊 Watchlist
        </button>
        <button
          onClick={() => setCurrentView('backtesting')}
          style={{
            padding: '8px 16px',
            backgroundColor: currentView === 'backtesting' ? '#4CAF50' : '#444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: currentView === 'backtesting' ? 'bold' : 'normal'
          }}
        >
          ⏱️ Backtesting
        </button>
      </div>

      <div style={{ marginTop: '50px' }}>
        {currentView === 'watchlist' && <Watchlist />}
        {currentView === 'backtesting' && <BacktestingApp />}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
