// src/components/AlertToggle.jsx
import React, { useState, useEffect } from "react";
import { API_BASE_URL } from "../config";
import "./AlertToggle.css";

const AlertToggle = () => {
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serviceDetails, setServiceDetails] = useState(null);

  // Cargar estado inicial de las alertas
  useEffect(() => {
    fetchAlertStatus();
  }, []);

  const fetchAlertStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/global-status`);
      const data = await response.json();
      if (data.success) {
        setAlertsEnabled(data.alertsEnabled || false);
        setServiceDetails(data.services);
      }
    } catch (error) {
      console.error("[AlertToggle] Error fetching status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    const newState = !alertsEnabled;
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/toggle-global`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });

      const data = await response.json();
      if (data.success) {
        setAlertsEnabled(newState);
        setServiceDetails(data.services);
        console.log(`[AlertToggle] Alertas globales ${newState ? 'activadas' : 'desactivadas'}`);
        console.log('[AlertToggle] Servicios afectados:', data.services);
      } else {
        console.error("[AlertToggle] Error toggling alerts:", data.error);
      }
    } catch (error) {
      console.error("[AlertToggle] Error toggling alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="alert-toggle-container">
      <button
        className={`alert-toggle-btn ${alertsEnabled ? 'enabled' : 'disabled'}`}
        onClick={handleToggle}
        disabled={loading}
        title={alertsEnabled ? "Alertas GLOBALES al Trading Bot ACTIVADAS - Click para desactivar" : "Alertas GLOBALES al Trading Bot DESACTIVADAS - Click para activar"}
      >
        <span className="toggle-icon">{alertsEnabled ? "🔔" : "🔕"}</span>
        <span className="toggle-text">
          {alertsEnabled ? "Alertas ON" : "Alertas OFF"}
        </span>
        <span className="toggle-indicator">
          <span className={`indicator-dot ${alertsEnabled ? 'on' : 'off'}`}></span>
        </span>
      </button>
      {alertsEnabled && (
        <div className="alert-warning">
          ⚠️ Las alertas están activas - Los detectores de patrones (Swing, DTB, Rejection) enviarán órdenes al Trading Bot
        </div>
      )}
      {serviceDetails && alertsEnabled && (
        <div className="alert-details">
          {serviceDetails.swing?.enabled && <span className="service-badge">Swing</span>}
          {serviceDetails.patterns?.enabled && (
            <>
              {serviceDetails.patterns.dbt_enabled_count > 0 && <span className="service-badge">DTB ({serviceDetails.patterns.dbt_enabled_count})</span>}
              {serviceDetails.patterns.rejection_enabled_count > 0 && <span className="service-badge">Rejection ({serviceDetails.patterns.rejection_enabled_count})</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertToggle;
