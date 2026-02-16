// FixedRangeProfilesManager.jsx
// Componente para crear y gestionar multiples Volume Profile Fixed Range

import React, { useState, useMemo } from "react";

const FixedRangeProfilesManager = ({
  symbol,
  profiles = [],
  onCreateProfile,
  onDeleteProfile,
  onToggleProfile,
  onConfigureProfile,
  onDeleteAllProfiles,
  onDeleteAllProfilesGlobal,
  chartRectangles = [],
  onStartDrawRectangle,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [showRectPicker, setShowRectPicker] = useState(false);

  // Rectangulos disponibles (filtrar los que ya tienen un VP Fixed creado)
  const existingRanges = useMemo(() => {
    const set = new Set();
    profiles.forEach(p => {
      if (p.sourceRectId) set.add(p.sourceRectId);
    });
    return set;
  }, [profiles]);

  const availableRects = useMemo(() => {
    return chartRectangles.map(rect => {
      const tStart = Math.min(rect.time1, rect.time2);
      const tEnd = Math.max(rect.time1, rect.time2);
      const pHigh = Math.max(rect.price1, rect.price2);
      const pLow = Math.min(rect.price1, rect.price2);
      return {
        id: rect.id,
        timeStart: tStart,
        timeEnd: tEnd,
        priceHigh: pHigh,
        priceLow: pLow,
        label: rect.label || null,
        alreadyUsed: existingRanges.has(rect.id),
      };
    }).sort((a, b) => b.timeStart - a.timeStart); // mas recientes primero
  }, [chartRectangles, existingRanges]);

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

    onCreateProfile(startTimestamp, endTimestamp, applyToAll);

    setStartDate("");
    setEndDate("");
    setApplyToAll(false);
    setShowModal(false);
  };

  const handleCreateFromRect = (rect) => {
    onCreateProfile(rect.timeStart, rect.timeEnd, applyToAll, rect.id);
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

  const formatPrice = (price) => {
    if (price >= 1000) return price.toFixed(1);
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
  };

  const rectBtnStyle = {
    padding: '6px 12px',
    backgroundColor: '#1565C0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
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
                  if (window.confirm(`Borrar TODOS los ${profiles.length} perfiles de ${symbol}? Esta accion no se puede deshacer.`)) {
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
                Borrar Todos ({symbol})
              </button>

              <button
                className="delete-all-global-btn"
                onClick={() => {
                  if (window.confirm(`Borrar TODOS los VP Fixed Ranges en TODAS LAS MONEDAS?\n\nEsta accion eliminara todos los perfiles globalmente y no se puede deshacer.`)) {
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
                Borrar TODOS (Global)
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

              {/* Seccion: Desde Rectangulo del Chart */}
              <div style={{
                marginBottom: '16px', padding: '12px',
                backgroundColor: 'rgba(21, 101, 192, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(21, 101, 192, 0.3)',
              }}>
                {availableRects.length > 0 ? (
                  <>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: '8px',
                    }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#90CAF9' }}>
                        Desde rectangulo del chart ({availableRects.length})
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {onStartDrawRectangle && (
                          <button
                            onClick={() => {
                              setShowModal(false);
                              onStartDrawRectangle();
                            }}
                            style={{
                              ...rectBtnStyle,
                              backgroundColor: '#2E7D32',
                              fontSize: '12px',
                            }}
                            title="Dibujar un nuevo rectangulo en el chart"
                          >
                            + Dibujar
                          </button>
                        )}
                        <button
                          onClick={() => setShowRectPicker(!showRectPicker)}
                          style={{
                            ...rectBtnStyle,
                            backgroundColor: showRectPicker ? '#555' : '#1565C0',
                            fontSize: '12px',
                          }}
                        >
                          {showRectPicker ? 'Ocultar' : 'Seleccionar'}
                        </button>
                      </div>
                    </div>

                    {showRectPicker && (
                      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {availableRects.map(rect => (
                          <div key={rect.id} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px', marginBottom: '4px',
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            opacity: rect.alreadyUsed ? 0.5 : 1,
                          }}>
                            <div style={{ flex: 1, fontSize: '11px' }}>
                              <div style={{ color: '#e0e0e0', fontWeight: 500 }}>
                                {rect.label ? `[${rect.label}] ` : ''}
                                {formatPrice(rect.priceLow)} - {formatPrice(rect.priceHigh)}
                              </div>
                              <div style={{ color: '#888', marginTop: '2px' }}>
                                {formatDate(rect.timeStart)} - {formatDate(rect.timeEnd)}
                              </div>
                            </div>
                            <button
                              onClick={() => handleCreateFromRect(rect)}
                              disabled={rect.alreadyUsed}
                              style={{
                                ...rectBtnStyle,
                                opacity: rect.alreadyUsed ? 0.4 : 1,
                                cursor: rect.alreadyUsed ? 'not-allowed' : 'pointer',
                              }}
                              title={rect.alreadyUsed ? 'Ya tiene un VP Fixed creado' : 'Crear VP Fixed desde este rectangulo'}
                            >
                              {rect.alreadyUsed ? 'Creado' : 'Usar'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {!showRectPicker && (
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        Selecciona un rectangulo existente o dibuja uno nuevo en el chart
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: '8px',
                    }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#90CAF9' }}>
                        Desde rectangulo del chart
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>
                      No hay rectangulos dibujados en el chart. Dibuja uno para definir visualmente el rango del VP Fixed.
                    </div>
                    {onStartDrawRectangle && (
                      <button
                        onClick={() => {
                          setShowModal(false);
                          onStartDrawRectangle();
                        }}
                        style={{
                          ...rectBtnStyle,
                          backgroundColor: '#2E7D32',
                          fontSize: '12px',
                          padding: '8px 16px',
                          width: '100%',
                        }}
                        title="Activar herramienta de rectangulo para dibujar en el chart"
                      >
                        Dibujar Rectangulo en el Chart
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Separador */}
              <div style={{
                textAlign: 'center', fontSize: '11px', color: '#666',
                margin: '12px 0', position: 'relative',
              }}>
                <span style={{ backgroundColor: '#1e1e2f', padding: '0 12px', position: 'relative', zIndex: 1 }}>
                  o ingresa fechas manualmente
                </span>
                <div style={{
                  position: 'absolute', top: '50%', left: 0, right: 0,
                  height: '1px', backgroundColor: 'rgba(255,255,255,0.1)',
                }} />
              </div>

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
