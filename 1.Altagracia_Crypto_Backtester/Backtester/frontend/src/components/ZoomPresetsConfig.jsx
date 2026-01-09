// src/components/ZoomPresetsConfig.jsx
// Componente para configurar presets personalizados de zoom

import React, { useState, useEffect } from "react";

const DEFAULT_PRESETS = [
  { id: 1, enabled: true, days: 1, label: "1D" },
  { id: 2, enabled: true, days: 3, label: "3D" },
  { id: 3, enabled: true, days: 7, label: "1W" },
  { id: 4, enabled: true, days: null, label: "ALL" }
];

const DAYS_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 15, 30, 60, 90, 180, 365, 730];

const ZoomPresetsConfig = ({ onClose, onApply }) => {
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    // Cargar presets desde localStorage
    const stored = localStorage.getItem('zoom_presets');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setPresets(parsed.presets || DEFAULT_PRESETS);
      } catch (e) {
        console.error('Error parsing zoom presets:', e);
        setPresets(DEFAULT_PRESETS);
      }
    } else {
      setPresets(DEFAULT_PRESETS);
    }
  }, []);

  const handleToggle = (id) => {
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    ));
  };

  const handleDaysChange = (id, days) => {
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, days: days === 'ALL' ? null : parseInt(days) } : p
    ));
  };

  const handleLabelChange = (id, label) => {
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, label } : p
    ));
  };

  const handleSave = () => {
    const config = { presets };
    localStorage.setItem('zoom_presets', JSON.stringify(config));
    onApply(presets);
    onClose();
  };

  const handleRestore = () => {
    setPresets(DEFAULT_PRESETS);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '500px',
          padding: '20px',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
        }}
      >
        <button
          className="modal-close-btn"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'transparent',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          ✕
        </button>

        <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', color: '#333' }}>
          Configurar Zoom Presets
        </h2>

        <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
          Personaliza los botones de zoom rápido. Los presets te permiten saltar a períodos específicos con un solo click.
        </p>

        <div style={{ marginBottom: '20px' }}>
          {presets.map((preset) => (
            <div
              key={preset.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px',
                padding: '10px',
                background: preset.enabled ? '#f8f9fa' : '#e9ecef',
                borderRadius: '4px',
                border: '1px solid #dee2e6'
              }}
            >
              <input
                type="checkbox"
                checked={preset.enabled}
                onChange={() => handleToggle(preset.id)}
                style={{ cursor: 'pointer' }}
              />

              <input
                type="text"
                value={preset.label}
                onChange={(e) => handleLabelChange(preset.id, e.target.value)}
                disabled={!preset.enabled}
                placeholder="Label"
                maxLength={4}
                style={{
                  width: '50px',
                  padding: '4px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '3px',
                  fontSize: '12px',
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}
              />

              <select
                value={preset.days === null ? 'ALL' : preset.days}
                onChange={(e) => handleDaysChange(preset.id, e.target.value)}
                disabled={!preset.enabled}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '3px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <option value="ALL">Todo el rango disponible</option>
                {DAYS_OPTIONS.map(days => (
                  <option key={days} value={days}>
                    {days} {days === 1 ? 'día' : 'días'}
                  </option>
                ))}
              </select>

              <span style={{ fontSize: '11px', color: '#6c757d', minWidth: '80px' }}>
                {preset.enabled ? '✓ Activo' : '✗ Desactivado'}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'flex-end',
          borderTop: '1px solid #dee2e6',
          paddingTop: '15px'
        }}>
          <button
            onClick={handleRestore}
            style={{
              padding: '8px 16px',
              border: '1px solid #6c757d',
              borderRadius: '4px',
              background: 'white',
              color: '#6c757d',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold'
            }}
          >
            Restaurar por defecto
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #6c757d',
              borderRadius: '4px',
              background: 'white',
              color: '#6c757d',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '4px',
              background: '#007bff',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold'
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZoomPresetsConfig;
