import React from "react";
import ReactDOM from "react-dom/client";
import BacktestingApp from "./components/backtesting/BacktestingApp";
import "./styles.css";
import "./volume_profile_styles.css";

const App = () => {
  return (
    <div>
      <BacktestingApp />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
