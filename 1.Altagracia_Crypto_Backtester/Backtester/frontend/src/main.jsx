import React from "react";
import ReactDOM from "react-dom/client";
import BacktestingApp from "./components/backtesting/BacktestingApp";
import "./styles.css";
import "./volume_profile_styles.css";

const App = () => {
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
        <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>
          📊 Crypto Backtester
        </h2>
      </div>

      <div style={{ marginTop: '50px' }}>
        <BacktestingApp />
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
