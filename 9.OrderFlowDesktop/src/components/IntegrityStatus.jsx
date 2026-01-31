// IntegrityStatus.jsx - Badge de estado de integridad del cache
//
// Muestra un indicador visual del estado de salud del cache de footprints.
// Siempre visible en el header de la aplicacion.

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';

const STATUS_COLORS = {
  healthy: '#4CAF50',    // Verde
  repairing: '#FFC107',  // Amarillo
  issues: '#f44336',     // Rojo
  unknown: '#9E9E9E'     // Gris
};

const STATUS_LABELS = {
  healthy: 'OF OK',
  repairing: 'Reparando...',
  issues: 'Problemas',
  unknown: 'Verificando...'
};

function IntegrityStatus({ onStatusChange }) {
  const [status, setStatus] = useState('unknown');
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [repairProgress, setRepairProgress] = useState(0);
  const [currentRepairSymbol, setCurrentRepairSymbol] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/integrity/status`);
      const data = await response.json();

      if (data.success) {
        setStatus(data.overall_status || 'unknown');
        setDetails({
          healthy: data.symbols_healthy || 0,
          issues: data.symbols_with_issues || 0,
          validations: data.validations || []
        });
        setRepairProgress(data.repair_progress || 0);
        setCurrentRepairSymbol(data.current_repair_symbol);

        if (onStatusChange) {
          onStatusChange(data.overall_status, data);
        }
      }
    } catch (error) {
      console.error('[IntegrityStatus] Error fetching status:', error);
      setStatus('unknown');
    }
  }, [onStatusChange]);

  // Fetch status on mount and periodically while repairing
  useEffect(() => {
    fetchStatus();

    // Poll more frequently while repairing
    const interval = setInterval(() => {
      if (status === 'repairing') {
        fetchStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchStatus, status]);

  // Refresh when user clicks
  const handleClick = () => {
    setIsLoading(true);
    fetchStatus().finally(() => setIsLoading(false));
  };

  const color = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  const label = STATUS_LABELS[status] || STATUS_LABELS.unknown;

  // Render tooltip content
  const renderTooltip = () => {
    if (!details) return null;

    const issueSymbols = details.validations?.filter(v => v.status === 'issues') || [];

    return (
      <div style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '8px',
        background: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '12px',
        minWidth: '220px',
        zIndex: 1000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
      }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#fff' }}>
          Estado del Cache
        </div>

        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Simbolos OK:</span>
            <span style={{ color: '#4CAF50' }}>{details.healthy}</span>
          </div>
          {details.issues > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Con problemas:</span>
              <span style={{ color: '#f44336' }}>{details.issues}</span>
            </div>
          )}
        </div>

        {status === 'repairing' && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#FFC107', marginBottom: '4px' }}>
              Reparando {currentRepairSymbol || '...'}
            </div>
            <div style={{
              height: '4px',
              background: '#444',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${repairProgress}%`,
                background: '#FFC107',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )}

        {issueSymbols.length > 0 && status !== 'repairing' && (
          <div style={{ fontSize: '11px', color: '#f44336' }}>
            <div style={{ marginBottom: '4px' }}>Problemas en:</div>
            {issueSymbols.slice(0, 3).map(v => (
              <div key={`${v.symbol}_${v.interval}`} style={{ marginLeft: '8px' }}>
                - {v.symbol}: {v.issues?.[0] || 'Error'}
              </div>
            ))}
            {issueSymbols.length > 3 && (
              <div style={{ marginLeft: '8px', fontStyle: 'italic' }}>
                ...y {issueSymbols.length - 3} mas
              </div>
            )}
          </div>
        )}

        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #444',
          fontSize: '10px',
          color: '#666'
        }}>
          Click para actualizar
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '12px',
        background: 'rgba(0,0,0,0.3)',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: '11px',
        fontWeight: 500
      }}
      onClick={handleClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Status dot */}
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        animation: status === 'repairing' ? 'pulse 1.5s infinite' : 'none'
      }} />

      {/* Label */}
      <span style={{ color: '#ddd' }}>
        {isLoading ? 'Verificando...' : label}
      </span>

      {/* Tooltip */}
      {showTooltip && renderTooltip()}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default IntegrityStatus;
