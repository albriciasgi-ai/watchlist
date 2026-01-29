import React from "react";
import ReactDOM from "react-dom/client";
import Watchlist from "./components/Watchlist";
import "./styles.css";
import "./volume_profile_styles.css";

// Log de inicio para Electron
console.log('====================================');
console.log('Watchlist Desktop - Renderer');
console.log('====================================');

// Verificar si estamos en Electron
if (window.electronAPI) {
  console.log('[Electron] Ejecutando en Electron');
  console.log('[Electron] Versiones:', window.electronAPI.versions);
} else {
  console.log('[Browser] Ejecutando en navegador');
}

// Render sin StrictMode para evitar doble montaje y mejorar rendimiento
ReactDOM.createRoot(document.getElementById("root")).render(
  <Watchlist />
);
