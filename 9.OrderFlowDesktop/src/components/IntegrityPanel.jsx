// IntegrityPanel.jsx - Panel de control de integridad del cache
//
// Permite al usuario validar, reparar y limpiar el cache de footprints.
// Se integra en OrderFlowSettings.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';

const STATUS_COLORS = {
  healthy: '#4CAF50',
  repairing: '#FFC107',
  issues: '#f44336',
  unknown: '#9E9E9E'
};

function IntegrityPanel({ onClose }) {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairProgress, setRepairProgress] = useState(0);
  const [currentRepairSymbol, setCurrentRepairSymbol] = useState(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [notification, setNotification] = useState(null);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/integrity/status`);
      const data = await response.json();

      if (data.success) {
        setStatus(data);
        setIsRepairing(data.is_repairing);
        setRepairProgress(data.repair_progress || 0);
        setCurrentRepairSymbol(data.current_repair_symbol);
      }
    } catch (error) {
      console.error('[IntegrityPanel] Error:', error);
      showNotification('Error al obtener estado', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Poll while repairing
    const interval = setInterval(() => {
      if (isRepairing) {
        fetchStatus();
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [fetchStatus, isRepairing]);

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Validate all
  const handleValidate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/integrity/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();

      if (data.success) {
        showNotification(
          `Validacion completada: ${data.symbols_healthy} OK, ${data.symbols_with_issues} con problemas`,
          data.symbols_with_issues > 0 ? 'warning' : 'success'
        );
        fetchStatus();
      } else {
        showNotification(data.error || 'Error en validacion', 'error');
      }
    } catch (error) {
      showNotification('Error de conexion', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Repair all
  const handleRepair = async () => {
    setIsRepairing(true);
    setRepairProgress(0);
    showNotification('Iniciando reparacion...', 'info');

    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/integrity/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();

      if (data.success) {
        const repaired = data.total_repaired || 0;
        const failed = data.total_failed || 0;

        if (failed > 0) {
          showNotification(`Reparacion parcial: ${repaired} OK, ${failed} fallidos`, 'warning');
        } else if (repaired > 0) {
          showNotification(`Reparacion exitosa: ${repaired} simbolos corregidos`, 'success');
        } else {
          showNotification('No habia nada que reparar', 'info');
        }
        fetchStatus();
      } else {
        showNotification(data.error || 'Error en reparacion', 'error');
      }
    } catch (error) {
      showNotification('Error de conexion', 'error');
    } finally {
      setIsRepairing(false);
    }
  };

  // Clear cache (with confirmation)
  const handleClearCache = async () => {
    if (!showConfirmClear) {
      setShowConfirmClear(true);
      return;
    }

    setShowConfirmClear(false);
    setIsRepairing(true);
    setRepairProgress(0);
    showNotification('Limpiando cache y recargando del cloud...', 'info');

    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/integrity/clear-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true })
      });
      const data = await response.json();

      if (data.success) {
        const loaded = data.results?.reduce((sum, r) => sum + (r.footprints_loaded || 0), 0) || 0;
        showNotification(`Cache recargado: ${loaded} footprints desde el cloud`, 'success');
        fetchStatus();
      } else {
        showNotification(data.error || 'Error al limpiar cache', 'error');
      }
    } catch (error) {
      showNotification('Error de conexion', 'error');
    } finally {
      setIsRepairing(false);
    }
  };

  const cancelClear = () => {
    setShowConfirmClear(false);
  };

  // Get overall status color
  const overallColor = STATUS_COLORS[status?.overall_status] || STATUS_COLORS.unknown;

  return (
    <div style={{
      background: '#1e1e1e',
      borderRadius: '8px',
      padding: '16px',
      marginTop: '16px',
      border: '1px solid #333'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '16px'
      }}>
        <span style={{ fontSize: '16px' }}>🛡️</span>
        <span style={{ fontWeight: 'bold', color: '#fff' }}>Integridad de Datos</span>

        {/* Status indicator */}
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: overallColor,
            boxShadow: `0 0 6px ${overallColor}`
          }} />
          <span style={{ fontSize: '12px', color: '#aaa' }}>
            {isLoading ? 'Cargando...' :
             isRepairing ? 'Reparando...' :
             status?.overall_status === 'healthy' ? 'Saludable' :
             status?.overall_status === 'issues' ? 'Problemas detectados' : 'Desconocido'}
          </span>
        </div>
      </div>

      {/* Stats */}
      {status && !isLoading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '16px',
          fontSize: '13px'
        }}>
          <div style={{
            background: '#252525',
            padding: '10px',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span style={{ color: '#888' }}>Simbolos OK</span>
            <span style={{ color: '#4CAF50', fontWeight: 'bold' }}>{status.symbols_healthy || 0}</span>
          </div>
          <div style={{
            background: '#252525',
            padding: '10px',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span style={{ color: '#888' }}>Con problemas</span>
            <span style={{
              color: (status.symbols_with_issues || 0) > 0 ? '#f44336' : '#4CAF50',
              fontWeight: 'bold'
            }}>
              {status.symbols_with_issues || 0}
            </span>
          </div>
        </div>
      )}

      {/* Progress bar (when repairing) */}
      {isRepairing && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#888',
            marginBottom: '4px'
          }}>
            <span>Reparando {currentRepairSymbol || '...'}</span>
            <span>{Math.round(repairProgress)}%</span>
          </div>
          <div style={{
            height: '6px',
            background: '#333',
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${repairProgress}%`,
              background: 'linear-gradient(90deg, #FFC107, #FF9800)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}

      {/* Issues list */}
      {status?.validations?.filter(v => v.status === 'issues').length > 0 && !isRepairing && (
        <div style={{
          background: 'rgba(244, 67, 54, 0.1)',
          border: '1px solid rgba(244, 67, 54, 0.3)',
          borderRadius: '6px',
          padding: '10px',
          marginBottom: '16px',
          fontSize: '12px'
        }}>
          <div style={{ color: '#f44336', marginBottom: '6px', fontWeight: 'bold' }}>
            Problemas detectados:
          </div>
          {status.validations
            .filter(v => v.status === 'issues')
            .slice(0, 5)
            .map(v => (
              <div key={`${v.symbol}_${v.interval}`} style={{ color: '#ffcdd2', marginLeft: '8px' }}>
                • {v.symbol} ({v.interval}m): {v.issues?.[0] || 'Error desconocido'}
              </div>
            ))
          }
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={handleValidate}
          disabled={isLoading || isRepairing}
          style={{
            flex: 1,
            minWidth: '100px',
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            background: '#2196F3',
            color: '#fff',
            cursor: isLoading || isRepairing ? 'not-allowed' : 'pointer',
            opacity: isLoading || isRepairing ? 0.5 : 1,
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          🔍 Validar
        </button>

        <button
          onClick={handleRepair}
          disabled={isLoading || isRepairing || status?.symbols_with_issues === 0}
          style={{
            flex: 1,
            minWidth: '100px',
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            background: '#FF9800',
            color: '#fff',
            cursor: (isLoading || isRepairing || status?.symbols_with_issues === 0) ? 'not-allowed' : 'pointer',
            opacity: (isLoading || isRepairing || status?.symbols_with_issues === 0) ? 0.5 : 1,
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          🔧 Reparar
        </button>
      </div>

      {/* Clear cache button */}
      <div style={{ marginTop: '12px' }}>
        {!showConfirmClear ? (
          <button
            onClick={handleClearCache}
            disabled={isLoading || isRepairing}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: '6px',
              border: '1px solid #f44336',
              background: 'transparent',
              color: '#f44336',
              cursor: isLoading || isRepairing ? 'not-allowed' : 'pointer',
              opacity: isLoading || isRepairing ? 0.5 : 1,
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            🗑️ Limpiar Cache Completo
          </button>
        ) : (
          <div style={{
            background: 'rgba(244, 67, 54, 0.1)',
            border: '1px solid #f44336',
            borderRadius: '6px',
            padding: '12px'
          }}>
            <div style={{ color: '#fff', marginBottom: '10px', fontSize: '13px' }}>
              ¿Seguro? Esto eliminara todo el cache local y recargara desde el cloud.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleClearCache}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#f44336',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Si, limpiar
              </button>
              <button
                onClick={cancelClear}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #666',
                  background: 'transparent',
                  color: '#aaa',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info text */}
      <div style={{
        marginTop: '12px',
        fontSize: '11px',
        color: '#666',
        lineHeight: '1.4'
      }}>
        La validacion verifica step_size y detecta gaps. La reparacion obtiene datos del cloud collector (Northflank).
      </div>

      {/* Notification toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '12px 20px',
          borderRadius: '8px',
          background: notification.type === 'error' ? '#f44336' :
                     notification.type === 'warning' ? '#FF9800' :
                     notification.type === 'success' ? '#4CAF50' : '#2196F3',
          color: '#fff',
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 10000,
          animation: 'slideIn 0.3s ease'
        }}>
          {notification.message}
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default IntegrityPanel;
