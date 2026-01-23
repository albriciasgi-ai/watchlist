// FixedRangeProfilesManager.jsx
// Componente para crear y gestionar multiples Volume Profile Fixed Range

import React, { useState } from "react";

const FixedRangeProfilesManager = ({
  symbol,
  profiles = [],
  onCreateProfile,
  onDeleteProfile,
  onToggleProfile,
  onConfigureProfile,
  onDeleteAllProfiles,  // ✅ Handler para borrar todos en esta moneda
  onDeleteAllProfilesGlobal  // ✅ NUEVO: Handler para borrar todos en TODAS las monedas
}) => {
  const [showModal, setShowModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [applyToAll, setApplyToAll] = useState(false); // ✅ NUEVO: Checkbox para aplicar a todas las monedas

  const handleCreate = () => {
    if (!startDate || !endDate) {
      alert("Por favor selecciona fecha de inicio y fecha final");
      return;
    }

    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();

    if (startTimestamp >= endTimestamp) {
      alert("La fecha de inicio debe ser anterior a la fecha final");
      return;
    }

    onCreateProfile(startTimestamp, endTimestamp, applyToAll); // ✅ Pasar applyToAll

    // Limpiar formulario y cerrar modal
    setStartDate("");
    setEndDate("");
    setApplyToAll(false);
    setShowModal(false);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-ES', { 
      day: '2-digit', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="fixed-range-profiles-manager">
      <div className="manager-header">
        <h4>VP Fixed Ranges ({symbol})</h4>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="create-profile-btn"
            onClick={() => setShowModal(true)}
            title="Crear nuevo perfil de rango fijo"
          >
            + Nuevo Rango
          </button>
          {profiles.length > 0 && (
            <>
              <button
                className="delete-all-btn"
                onClick={() => {
                  if (window.confirm(`¿Borrar TODOS los ${profiles.length} perfiles de ${symbol}? Esta acción no se puede deshacer.`)) {
                    onDeleteAllProfiles();
                  }
                }}
                title="Eliminar todos los perfiles de esta moneda"
                style={{
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
              >
                🗑️ Borrar Todos ({symbol})
              </button>

              <button
                className="delete-all-global-btn"
                onClick={() => {
                  if (window.confirm(`⚠️ ¿Borrar TODOS los VP Fixed Ranges en TODAS LAS MONEDAS?\n\nEsta acción eliminará todos los perfiles globalmente y no se puede deshacer.`)) {
                    if (onDeleteAllProfilesGlobal) {
                      onDeleteAllProfilesGlobal();
                    }
                  }
                }}
                title="Eliminar todos los perfiles en TODAS las monedas"
                style={{
                  background: '#c62828',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginLeft: '5px'
                }}
              >
                🗑️ Borrar TODOS (Global)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Lista de perfiles */}
      {profiles.length > 0 && (
        <div className="profiles-list">
          {profiles.map((profile) => (
            <div key={profile.rangeId} className="profile-item">
              <input
                type="checkbox"
                checked={profile.enabled}
                onChange={(e) => onToggleProfile(profile.rangeId, e.target.checked)}
                title="Activar/Desactivar perfil"
              />
              <span className="profile-name">Range {profile.rangeId}</span>
              <span className="profile-dates">
                {formatDate(profile.startTimestamp)} - {formatDate(profile.endTimestamp)}
              </span>
              <div className="profile-actions">
                {/* Boton de configuracion */}
                <button
                  className="configure-profile-btn"
                  onClick={() => onConfigureProfile(profile.rangeId)}
                  title="Configurar este perfil"
                >
                  Config
                </button>
                <button
                  className="delete-profile-btn"
                  onClick={() => {
                    if (confirm(`Eliminar Range ${profile.rangeId}?`)) {
                      onDeleteProfile(profile.rangeId);
                    }
                  }}
                  title="Eliminar este perfil"
                >
                  X
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {profiles.length === 0 && (
        <p className="no-profiles-message">
          No hay perfiles de rango fijo. Haz clic en "+ Nuevo Rango" para crear uno.
        </p>
      )}

      {/* Modal para crear nuevo perfil */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo VP Fixed Range</h3>
              <button 
                className="modal-close-btn"
                onClick={() => setShowModal(false)}
              >
                X
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Fecha inicio:</label>
                <input 
                  type="datetime-local" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label>Fecha final:</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>

              {/* ✅ NUEVO: Checkbox para aplicar a todas las monedas */}
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="applyToAll"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                />
                <label htmlFor="applyToAll" style={{ margin: 0, cursor: 'pointer' }}>
                  Aplicar este rango a <strong>todas las monedas</strong>
                </label>
              </div>

              <button
                className="apply-range-btn"
                onClick={handleCreate}
              >
                Crear Perfil{applyToAll ? ' (Para Todas)' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixedRangeProfilesManager;
