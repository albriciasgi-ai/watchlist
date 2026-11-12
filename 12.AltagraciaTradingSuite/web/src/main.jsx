import React from 'react';
import ReactDOM from 'react-dom/client';
import SuiteApp from './SuiteApp.jsx';
// Estilos de App 1: la suite tiene su mismo formato visual (estilo Nitido y los demas del modal "Estilo")
import '@app1/styles.css';
import '@app1/volume_profile_styles.css';
import '@app1/backtesting_styles.css';
import '@app1/theme_nitido.css';
import './suite.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SuiteApp />
  </React.StrictMode>
);
