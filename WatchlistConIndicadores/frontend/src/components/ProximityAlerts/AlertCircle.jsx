// src/components/ProximityAlerts/AlertCircle.jsx
import React from "react";
import "./AlertCircle.css";

/**
 * AlertCircle - Componente que visualiza una alerta de proximidad
 *
 * Props:
 * - alert: Objeto con configuración de la alerta
 * - state: Estado actual de la alerta (score, phase, etc.)
 * - onClick: Callback para editar/configurar
 */
const AlertCircle = ({ alert, state, onClick }) => {
  if (!alert) {
    return null;
  }

  const { name, symbol, enabled } = alert;
  const {
    totalScore = 0,
    phase = "idle",
    currentPrice,
    targetPrice,
    distancePct,
    volumeTrend,
    currentZScore,
  } = state || {};

  // Si la alerta está deshabilitada, mostrar círculo apagado
  if (!enabled) {
    return (
      <div className="alert-circle-container" onClick={onClick}>
        <div className="alert-circle disabled">
          <div className="alert-circle-content">
            <div className="alert-symbol">{symbol}</div>
            <div className="alert-status">OFF</div>
          </div>
        </div>
        <div className="alert-label">{name}</div>
      </div>
    );
  }

  // Calcular tamaño basado en score (40px idle → 80px active)
  const baseSize = 40;
  const maxSize = 80;
  const size = baseSize + ((totalScore / 100) * (maxSize - baseSize));

  // Determinar color basado en fase
  let color = "#333"; // idle - gris oscuro
  let glowColor = "transparent";

  if (phase === "active") {
    // Verde si volumen alto, rojo si bajo
    color = volumeTrend === "increasing" ? "#4caf50" : "#f44336";
    glowColor = color;
  } else if (phase === "in_zone") {
    color = "#ffb74d"; // amarillo
    glowColor = color;
  } else if (phase === "approaching") {
    color = "#4a9eff"; // azul
    glowColor = color;
  }

  // Calcular intensidad del glow (0-20px)
  const glowIntensity = (totalScore / 100) * 20;

  // Determinar si debe animar (pulse)
  const shouldPulse = phase === "active" || phase === "in_zone";

  return (
    <div className="alert-circle-container" onClick={onClick}>
      <div
        className={`alert-circle ${phase} ${shouldPulse ? "pulse" : ""}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${glowIntensity}px ${glowColor}`,
        }}
      >
        <div className="alert-circle-content">
          <div className="alert-symbol">{symbol}</div>
          <div className="alert-score">{Math.round(totalScore)}</div>
        </div>

        {/* Indicador de volumen */}
        {volumeTrend === "increasing" && currentZScore > 1.5 && (
          <div className="volume-indicator">
            <span className="volume-arrow">↑</span>
          </div>
        )}
      </div>

      {/* Tooltip con detalles */}
      <div className="alert-tooltip">
        <div className="tooltip-header">{name}</div>
        <div className="tooltip-row">
          <span className="tooltip-label">Precio:</span>
          <span className="tooltip-value">${currentPrice?.toLocaleString()}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Target:</span>
          <span className="tooltip-value">${targetPrice?.toLocaleString()}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Distancia:</span>
          <span className="tooltip-value">{distancePct?.toFixed(2)}%</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Score:</span>
          <span className="tooltip-value">{Math.round(totalScore)}/100</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Z-Score Vol:</span>
          <span className="tooltip-value">{currentZScore?.toFixed(2)}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Fase:</span>
          <span className="tooltip-value tooltip-phase">{phase}</span>
        </div>
      </div>

      {/* Label debajo del círculo */}
      <div className="alert-label">{name}</div>
    </div>
  );
};

export default AlertCircle;
