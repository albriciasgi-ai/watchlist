import React from "react";
import ReactDOM from "react-dom/client";
import BacktestingApp from "./components/backtesting/BacktestingApp";
import SecondaryChartApp from "./components/backtesting/SecondaryChartApp";
import { isSecondaryChart } from "./components/backtesting/replayChannel.js";
import "./styles.css";
import "./volume_profile_styles.css";
import "./theme_nitido.css"; // Estilo Nítido (uiTheme.js); el clásico no lo usa

const App = () => {
  return (
    <div>
      {/* ?grafico=2: segundo gráfico que sigue la reproducción de la pestaña principal */}
      {isSecondaryChart() ? <SecondaryChartApp /> : <BacktestingApp />}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
