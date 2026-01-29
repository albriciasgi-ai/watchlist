// StrategyList.jsx
// Lista de estrategias guardadas con acciones CRUD

import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const StrategyList = ({ onSelect, onEdit, onNew, selectedId }) => {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies`);
      const data = await response.json();
      if (data.success) {
        setStrategies(data.strategies);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        setStrategies(prev => prev.filter(s => s.id !== id));
        setConfirmDelete(null);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDuplicate = async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (data.success) {
        loadStrategies(); // Recargar lista
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredStrategies = strategies.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.tags?.some(t => t.toLowerCase().includes(filter.toLowerCase()))
  );

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return <div className="sl-loading">Cargando estrategias...</div>;
  }

  return (
    <div className="sl-container">
      <div className="sl-header">
        <h3>Estrategias</h3>
        <button onClick={onNew} className="sl-btn primary">
          + Nueva
        </button>
      </div>

      {error && <div className="sl-error">{error}</div>}

      <div className="sl-filter">
        <input
          type="text"
          placeholder="Buscar por nombre o tag..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {filteredStrategies.length === 0 ? (
        <div className="sl-empty">
          {strategies.length === 0
            ? 'No hay estrategias. Crea una nueva o usa un template.'
            : 'No se encontraron estrategias con ese filtro.'}
        </div>
      ) : (
        <div className="sl-list">
          {filteredStrategies.map(strategy => (
            <div
              key={strategy.id}
              className={`sl-item ${selectedId === strategy.id ? 'selected' : ''} ${!strategy.is_active ? 'inactive' : ''}`}
              onClick={() => onSelect && onSelect(strategy.id)}
            >
              <div className="sl-item-main">
                <div className="sl-item-name">
                  {strategy.name}
                  {!strategy.is_active && <span className="sl-badge inactive">Inactiva</span>}
                </div>
                <div className="sl-item-desc">
                  {strategy.description || 'Sin descripción'}
                </div>
                {strategy.tags && strategy.tags.length > 0 && (
                  <div className="sl-item-tags">
                    {strategy.tags.map(tag => (
                      <span key={tag} className="sl-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="sl-item-meta">
                <span className="sl-item-date">
                  {formatDate(strategy.updated_at)}
                </span>
                <span className="sl-item-version">v{strategy.version}</span>
              </div>

              <div className="sl-item-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onEdit && onEdit(strategy.id)}
                  className="sl-action-btn"
                  title="Editar"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDuplicate(strategy.id)}
                  className="sl-action-btn"
                  title="Duplicar"
                >
                  📋
                </button>
                {confirmDelete === strategy.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(strategy.id)}
                      className="sl-action-btn danger"
                      title="Confirmar eliminación"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="sl-action-btn"
                      title="Cancelar"
                    >
                      ✗
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(strategy.id)}
                    className="sl-action-btn"
                    title="Eliminar"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sl-footer">
        <span>{filteredStrategies.length} de {strategies.length} estrategias</span>
        <button onClick={loadStrategies} className="sl-btn small">
          ↻ Actualizar
        </button>
      </div>
    </div>
  );
};

export default StrategyList;
