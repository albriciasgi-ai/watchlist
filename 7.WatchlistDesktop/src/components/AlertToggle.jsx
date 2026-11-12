// src/components/AlertToggle.jsx
import React, { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../config";
import "./AlertToggle.css";

// Cada cuánto se vuelve a leer el estado del backend
const STATUS_REFRESH_MS = 15000;

const AlertToggle = () => {
  // null = estado desconocido. Antes nacía en OFF y, si la única lectura fallaba (backend aún
  // arrancando o reiniciado), mostraba "Alertas OFF" con el Swing enviando al bot.
  const [alertsEnabled, setAlertsEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serviceDetails, setServiceDetails] = useState(null);
  const mountedRef = useRef(true);

  // Cargar estado inicial y volver a leerlo cada 15 s (lo que cambie otra página o un reinicio)
  useEffect(() => {
    mountedRef.current = true;
    fetchAlertStatus();
    const timer = setInterval(fetchAlertStatus, STATUS_REFRESH_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  const fetchAlertStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/global-status`);
      const data = await response.json();
      if (!mountedRef.current) return null;
      if (data.success) {
        setAlertsEnabled(Boolean(data.alertsEnabled));
        setServiceDetails(data.services);
        return Boolean(data.alertsEnabled);
      }
      setAlertsEnabled(null);
    } catch (error) {
      if (mountedRef.current) setAlertsEnabled(null);
      console.warn("[AlertToggle] No se pudo leer el estado de las alertas:", error.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    return null;
  };

  const handleToggle = async () => {
    setLoading(true);
    // Con el estado desconocido no se adivina: primero se lee
    const current = alertsEnabled === null ? await fetchAlertStatus() : alertsEnabled;
    if (current === null) {
      setLoading(false);
      window.alert("No se pudo leer el estado de las alertas en el backend (puerto 8000). No se cambió nada.");
      return;
    }
    const newState = !current;

    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/toggle-global`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });

      const data = await response.json();
      if (data.success) {
        console.log(`[AlertToggle] Alertas del Swing ${newState ? 'activadas' : 'desactivadas'}`);
      } else {
        console.error("[AlertToggle] Error toggling alerts:", data.error);
      }
    } catch (error) {
      console.error("[AlertToggle] Error toggling alerts:", error);
    } finally {
      // Lo que se muestra es lo que dice el backend después del cambio, no lo que se pidió
      await fetchAlertStatus();
      if (mountedRef.current) setLoading(false);
    }
  };

  const unknown = alertsEnabled === null;
  const swingInterval = serviceDetails?.swing?.interval;
  const configError = serviceDetails?.swing?.configError;

  return (
    <div className="alert-toggle-container">
      <button
        className={`alert-toggle-btn ${alertsEnabled ? 'enabled' : 'disabled'}`}
        onClick={handleToggle}
        disabled={loading}
        title={unknown
          ? "No se pudo leer el estado de las alertas en el backend - Click para reintentar"
          : alertsEnabled
            ? "Alertas del Swing al Trading Bot ACTIVADAS - Click para desactivar"
            : "Alertas del Swing al Trading Bot DESACTIVADAS - Click para activar"}
      >
        <span className="toggle-icon">{unknown ? "❔" : alertsEnabled ? "🔔" : "🔕"}</span>
        <span className="toggle-text">
          {unknown ? "Alertas ?" : alertsEnabled ? "Alertas ON" : "Alertas OFF"}
        </span>
        <span className="toggle-indicator">
          <span className={`indicator-dot ${alertsEnabled ? 'on' : 'off'}`}></span>
        </span>
      </button>
      {alertsEnabled && (
        <div className="alert-warning">
          ⚠️ Las alertas están activas - El Swing{swingInterval ? ` (${swingInterval}m)` : ''} enviará órdenes al Trading Bot. Double Top/Bottom y Rejection no envían.
        </div>
      )}
      {configError && (
        <div className="alert-warning">
          ⚠️ swing_config.json no se pudo usar ({configError}): alertas del Swing apagadas hasta revisarlo
        </div>
      )}
      {serviceDetails && alertsEnabled && (
        <div className="alert-details">
          {serviceDetails.swing?.enabled && <span className="service-badge">Swing</span>}
        </div>
      )}
    </div>
  );
};

export default AlertToggle;
