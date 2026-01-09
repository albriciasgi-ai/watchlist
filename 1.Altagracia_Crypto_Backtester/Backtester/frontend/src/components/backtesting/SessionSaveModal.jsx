import React, { useState } from 'react';
import './SessionModals.css';

/**
 * Modal para guardar sesiones de backtesting
 */
const SessionSaveModal = ({
  sessionManager,
  currentSession,
  getStateCallback,
  onClose,
  onSaved
}) => {
  const [sessionName, setSessionName] = useState(
    currentSession?.sessionName || `Sesión ${new Date().toLocaleDateString('es-CO')}`
  );
  const [tags, setTags] = useState(
    currentSession?.metadata?.tags?.join(', ') || ''
  );
  const [notes, setNotes] = useState(
    currentSession?.metadata?.notes || ''
  );
  const [autoSave, setAutoSave] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Maneja el guardado de la sesión
   */
  const handleSave = async () => {
    try {
      setSaving(true);

      // Obtener estado actual desde el callback
      const state = getStateCallback();

      if (!state) {
        alert('Error: No se pudo capturar el estado de la sesión');
        return;
      }

      // Generar sessionId si no existe
      const sessionId = currentSession?.sessionId ||
        `session_${state.symbol}_${state.timeframe}_${Date.now()}`;

      // Construir objeto de sesión completo
      const sessionData = {
        ...state,
        sessionId,
        sessionName,
        createdAt: currentSession?.createdAt || Date.now(),
        lastModified: Date.now(),
        metadata: {
          totalTrades: state.orderManagerState?.orders?.filter(o => o.status === 'closed').length || 0,
          winRate: calculateWinRate(state.orderManagerState?.orders || []),
          currentDrawdown: calculateDrawdown(state.orderManagerState),
          tags: tags.split(',').map(t => t.trim()).filter(t => t !== ''),
          notes
        }
      };

      // Guardar sesión
      await sessionManager.saveSession(sessionData);

      console.log('[SessionSaveModal] Sesión guardada:', sessionId);

      // Habilitar auto-save si fue solicitado
      if (autoSave) {
        sessionManager.enableAutoSave(sessionId, getStateCallback, 30);
      }

      // Notificar al componente padre
      if (onSaved) {
        onSaved(sessionData);
      }

      alert(`✅ Sesión guardada: ${sessionName}`);
      onClose();
    } catch (error) {
      console.error('[SessionSaveModal] Error al guardar:', error);
      alert(`❌ Error al guardar sesión: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Calcula win rate de las órdenes
   */
  const calculateWinRate = (orders) => {
    const closedOrders = orders.filter(o => o.status === 'closed');
    if (closedOrders.length === 0) return 0;

    const wins = closedOrders.filter(o => o.pnl > 0).length;
    return ((wins / closedOrders.length) * 100).toFixed(2);
  };

  /**
   * Calcula drawdown actual
   */
  const calculateDrawdown = (orderManagerState) => {
    if (!orderManagerState) return 0;

    const balance = orderManagerState.currentBalance || orderManagerState.initialBalance;
    const initial = orderManagerState.initialBalance;

    if (balance >= initial) return 0;

    return (((initial - balance) / initial) * 100).toFixed(2);
  };

  return (
    <div className="session-modal-overlay" onClick={onClose}>
      <div className="session-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="session-modal-header">
          <h3>💾 Guardar Sesión</h3>
          <button className="session-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="session-modal-body">
          <div className="session-form-group">
            <label>Nombre de la sesión:</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Estrategia Fibonacci - Diciembre 2024"
              autoFocus
            />
          </div>

          <div className="session-form-group">
            <label>Tags (separados por coma):</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="fibonacci, scalping, breakout"
            />
            <small>Opcional: ayuda a organizar tus sesiones</small>
          </div>

          <div className="session-form-group">
            <label>Notas:</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Probando estrategia con niveles de fibonacci en BTCUSDT..."
              rows="4"
            />
          </div>

          <div className="session-form-group">
            <label className="session-checkbox-label">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
              />
              <span>Auto-guardar cada 30 segundos</span>
            </label>
            <small>Guardará automáticamente los cambios mientras trabajas</small>
          </div>
        </div>

        <div className="session-modal-footer">
          <button
            className="session-btn session-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="session-btn session-btn-primary"
            onClick={handleSave}
            disabled={saving || !sessionName.trim()}
          >
            {saving ? 'Guardando...' : '💾 Guardar Sesión'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionSaveModal;
