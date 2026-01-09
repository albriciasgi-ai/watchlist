import React, { useState, useEffect } from 'react';
import './SessionModals.css';

/**
 * Modal para cargar sesiones guardadas
 */
const SessionLoadModal = ({
  sessionManager,
  currentSymbol,
  currentTimeframe,
  onClose,
  onLoad,
  onImport
}) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState(currentSymbol || '');
  const [filterTimeframe, setFilterTimeframe] = useState(''); // 🔧 FIX: No filtrar por timeframe por defecto (mostrar todas las sesiones antiguas y nuevas)

  /**
   * Carga las sesiones al montar el componente
   */
  useEffect(() => {
    loadSessions();
  }, [filterSymbol, filterTimeframe]);

  /**
   * Carga sesiones desde IndexedDB
   */
  const loadSessions = async () => {
    try {
      setLoading(true);

      const filters = {};
      if (filterSymbol) filters.symbol = filterSymbol;
      if (filterTimeframe) filters.timeframe = filterTimeframe;

      const result = await sessionManager.listSessions(filters);
      setSessions(result);

      console.log('[SessionLoadModal] Sesiones cargadas:', result.length);
    } catch (error) {
      console.error('[SessionLoadModal] Error al cargar sesiones:', error);
      alert('Error al cargar sesiones');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Maneja la carga de una sesión
   */
  const handleLoadSession = async (sessionId) => {
    try {
      const session = await sessionManager.loadSession(sessionId);

      if (!session) {
        alert('Sesión no encontrada');
        return;
      }

      console.log('[SessionLoadModal] Cargando sesión:', session.sessionName);

      if (onLoad) {
        onLoad(session);
      }

      onClose();
    } catch (error) {
      console.error('[SessionLoadModal] Error al cargar sesión:', error);
      alert(`Error al cargar sesión: ${error.message}`);
    }
  };

  /**
   * Maneja la eliminación de una sesión
   */
  const handleDeleteSession = async (sessionId, sessionName) => {
    if (!confirm(`¿Eliminar la sesión "${sessionName}"?`)) {
      return;
    }

    try {
      await sessionManager.deleteSession(sessionId);
      console.log('[SessionLoadModal] Sesión eliminada:', sessionId);

      // Recargar lista
      loadSessions();

      alert('Sesión eliminada exitosamente');
    } catch (error) {
      console.error('[SessionLoadModal] Error al eliminar sesión:', error);
      alert(`Error al eliminar sesión: ${error.message}`);
    }
  };

  /**
   * Maneja la exportación de una sesión
   */
  const handleExportSession = async (sessionId) => {
    try {
      await sessionManager.exportSession(sessionId);
      alert('Sesión exportada exitosamente');
    } catch (error) {
      console.error('[SessionLoadModal] Error al exportar:', error);
      alert(`Error al exportar: ${error.message}`);
    }
  };

  /**
   * Maneja la importación de una sesión desde archivo
   */
  const handleImportFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const sessionData = JSON.parse(text);

        await sessionManager.importSession(sessionData);

        alert('Sesión importada exitosamente');

        // Recargar lista
        loadSessions();

        if (onImport) {
          onImport(sessionData);
        }
      } catch (error) {
        console.error('[SessionLoadModal] Error al importar:', error);
        alert(`Error al importar sesión: ${error.message}`);
      }
    };

    input.click();
  };

  /**
   * Formatea una fecha a string legible
   */
  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="session-modal-overlay" onClick={onClose}>
      <div className="session-modal-content session-modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="session-modal-header">
          <h3>📂 Cargar Sesión</h3>
          <button className="session-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="session-modal-body">
          {/* Filtros */}
          <div className="session-filters">
            <div className="session-filter-group">
              <label>Símbolo:</label>
              <input
                type="text"
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value.toUpperCase())}
                placeholder="BTCUSDT"
              />
            </div>
            <div className="session-filter-group">
              <label>Timeframe:</label>
              <select
                value={filterTimeframe}
                onChange={(e) => setFilterTimeframe(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
              </select>
            </div>
          </div>

          {/* Lista de sesiones */}
          <div className="session-list">
            {loading ? (
              <div className="session-loading">Cargando sesiones...</div>
            ) : sessions.length === 0 ? (
              <div className="session-empty">
                No hay sesiones guardadas
                {(filterSymbol || filterTimeframe) && ' con estos filtros'}
              </div>
            ) : (
              sessions.map((session) => (
                <div key={session.sessionId} className="session-item">
                  <div className="session-item-header">
                    <div className="session-item-title">
                      <span className="session-icon">📊</span>
                      <span className="session-name">{session.sessionName}</span>
                    </div>
                    <div className="session-item-symbol">
                      {session.symbol} - {session.timeframe}
                    </div>
                  </div>

                  <div className="session-item-stats">
                    <span>
                      {session.metadata?.totalTrades || 0} trades
                    </span>
                    <span className="session-separator">|</span>
                    <span className={session.metadata?.winRate >= 50 ? 'session-positive' : 'session-negative'}>
                      {session.metadata?.winRate || 0}% WR
                    </span>
                    {session.metadata?.tags && session.metadata.tags.length > 0 && (
                      <>
                        <span className="session-separator">|</span>
                        <span className="session-tags">
                          {session.metadata.tags.slice(0, 2).join(', ')}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="session-item-date">
                    Guardado: {formatDate(session.lastModified)}
                  </div>

                  {session.metadata?.notes && (
                    <div className="session-item-notes">
                      "{session.metadata.notes.substring(0, 80)}
                      {session.metadata.notes.length > 80 ? '...' : ''}"
                    </div>
                  )}

                  <div className="session-item-actions">
                    <button
                      className="session-btn-action session-btn-load"
                      onClick={() => handleLoadSession(session.sessionId)}
                    >
                      ▶ Cargar
                    </button>
                    <button
                      className="session-btn-action session-btn-export"
                      onClick={() => handleExportSession(session.sessionId)}
                      title="Exportar a JSON"
                    >
                      📥
                    </button>
                    <button
                      className="session-btn-action session-btn-delete"
                      onClick={() => handleDeleteSession(session.sessionId, session.sessionName)}
                      title="Eliminar"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="session-modal-footer">
          <button
            className="session-btn session-btn-secondary"
            onClick={handleImportFile}
          >
            📥 Importar JSON
          </button>
          <button
            className="session-btn session-btn-primary"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionLoadModal;
