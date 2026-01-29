/**
 * Analizador Desktop - Entry Point
 *
 * Punto de entrada de la aplicacion React.
 * Renderiza el componente SingleSymbolAnalyzer sin StrictMode
 * para evitar doble montaje de componentes.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import SingleSymbolAnalyzer from "./components/SingleSymbolAnalyzer";
import "./styles.css";

// Log de inicio
console.log('====================================');
console.log('Analizador Desktop - Frontend');
console.log('====================================');

// Detectar si estamos en Electron
if (window.electronAPI) {
  console.log('[Electron] Ejecutando en Electron');
  console.log('[Electron] Versiones:', window.electronAPI.versions);
  console.log('[Electron] Plataforma:', window.electronAPI.platform);
} else {
  console.log('[Browser] Ejecutando en navegador (modo desarrollo)');
}

console.log('[App] Backend esperado en: http://localhost:10000');

// Renderizar sin StrictMode para evitar doble montaje
// que puede causar problemas con indicadores y WebSocket
ReactDOM.createRoot(document.getElementById("root")).render(
  <SingleSymbolAnalyzer />
);
