// src/components/ProximityAlerts/ProximityAlertDashboard.jsx
import React, { useState } from "react";
import AlertCircle from "./AlertCircle";
import AlertConfigModal from "./AlertConfigModal";
import useProximityAlerts from "./useProximityAlerts";
import "./ProximityAlertDashboard.css";

/**
 * ProximityAlertDashboard - Panel superior que muestra círculos de alertas
 *
 * Se ubica arriba de los minicharts y muestra el estado de todas las alertas configuradas
 */
const ProximityAlertDashboard = ({ symbols }) => {
  const {
    alerts,
    alertStates,
    addAlert,
    updateAlert,
    deleteAlert,
    isPolling,
  } = useProximityAlerts();

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);

  const handleCircleClick = (alert) => {
    setEditingAlert(alert);
    setShowConfigModal(true);
  };

  const handleAddNewAlert = () => {
    setEditingAlert(null);
    setShowConfigModal(true);
  };

  const handleSaveAlert = (alertData) => {
    console.log('[Dashboard] handleSaveAlert called with:', alertData);
    console.log('[Dashboard] editingAlert:', editingAlert);

    // Si editingAlert tiene un id válido (no undefined y no "disabled"), es una edición
    const isEditing = editingAlert?.id && !editingAlert.id.includes('disabled');

    if (isEditing) {
      // Actualizar alerta existente
      console.log('[Dashboard] Updating existing alert');
      updateAlert(editingAlert.id, alertData);
    } else {
      // Crear nueva alerta
      console.log('[Dashboard] Creating new alert');
      addAlert(alertData);
    }
    setShowConfigModal(false);
    setEditingAlert(null);
  };

  const handleDeleteAlert = (alertId) => {
    deleteAlert(alertId);
    setShowConfigModal(false);
    setEditingAlert(null);
  };

  const handleCloseModal = () => {
    setShowConfigModal(false);
    setEditingAlert(null);
  };

  // Crear círculos para todas las monedas del watchlist
  const alertCircles = symbols.map((symbol) => {
    // Buscar alertas para este símbolo
    const symbolAlerts = alerts.filter((a) => a.symbol === symbol);

    // Si no hay alertas para este símbolo, mostrar círculo apagado
    if (symbolAlerts.length === 0) {
      return (
        <AlertCircle
          key={`${symbol}-disabled`}
          alert={{
            id: `${symbol}-disabled`,
            symbol,
            name: symbol,
            enabled: false,
          }}
          state={{}}
          onClick={() => {
            // Al hacer click en círculo apagado, abrir modal para crear alerta
            setEditingAlert({ symbol, name: `${symbol} Alert` });
            setShowConfigModal(true);
          }}
        />
      );
    }

    // Si hay alertas, mostrar la más relevante (mayor score)
    const topAlert = symbolAlerts.reduce((prev, current) => {
      const prevState = alertStates[prev.id] || { totalScore: 0 };
      const currentState = alertStates[current.id] || { totalScore: 0 };
      return currentState.totalScore > prevState.totalScore ? current : prev;
    });

    const state = alertStates[topAlert.id] || {};

    return (
      <AlertCircle
        key={topAlert.id}
        alert={topAlert}
        state={state}
        onClick={() => handleCircleClick(topAlert)}
      />
    );
  });

  return (
    <div className="proximity-alert-dashboard">
      {/* Header con botón de configuración */}
      <div className="dashboard-header">
        <div className="dashboard-title">
          <span className="title-icon">🎯</span>
          <span className="title-text">Alertas de Proximidad</span>
          {isPolling && (
            <span className="polling-indicator" title="Actualizando...">
              ●
            </span>
          )}
        </div>

        <div className="dashboard-actions">
          <button className="btn-add-alert" onClick={handleAddNewAlert}>
            + Nueva Alerta
          </button>
        </div>
      </div>

      {/* Grid de círculos */}
      <div className="alert-circles-grid">{alertCircles}</div>

      {/* Modal de configuración */}
      {showConfigModal && (
        <AlertConfigModal
          alert={editingAlert}
          symbols={symbols}
          onSave={handleSaveAlert}
          onDelete={handleDeleteAlert}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default ProximityAlertDashboard;
