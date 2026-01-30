/**
 * ConnectionStatus.jsx - Indicador visual de conexion al backend
 *
 * Muestra un punto verde/rojo en la esquina superior derecha
 * indicando si el backend esta conectado o no.
 */

import React, { useState, useEffect } from 'react';
import { onConnectionChange, getHealthCheckState, checkBackendHealth } from '../utils/robustness';

const ConnectionStatus = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);
  const [healthState, setHealthState] = useState(getHealthCheckState());

  useEffect(() => {
    // Suscribirse a cambios de conexion
    const unsubscribe = onConnectionChange((connected) => {
      setIsConnected(connected);
      setHealthState(getHealthCheckState());
    });

    return () => unsubscribe();
  }, []);

  // Actualizar estado al hacer hover
  const handleMouseEnter = () => {
    setHealthState(getHealthCheckState());
    setShowTooltip(true);
  };

  // Intentar reconectar al hacer click
  const handleClick = async () => {
    if (!isConnected) {
      console.log('[ConnectionStatus] Manual reconnect attempt...');
      await checkBackendHealth();
      setHealthState(getHealthCheckState());
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        cursor: isConnected ? 'default' : 'pointer'
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={handleClick}
      title={isConnected ? 'Backend connected' : 'Click to retry connection'}
    >
      {/* Indicador de estado */}
      <div
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#4CAF50' : '#F44336',
          boxShadow: isConnected
            ? '0 0 6px rgba(76, 175, 80, 0.6)'
            : '0 0 6px rgba(244, 67, 54, 0.6)',
          transition: 'all 0.3s ease',
          animation: !isConnected ? 'pulse 1.5s infinite' : 'none'
        }}
      />

      {/* Texto de estado */}
      <span
        style={{
          marginLeft: '6px',
          fontSize: '11px',
          color: isConnected ? '#4CAF50' : '#F44336',
          fontWeight: '500'
        }}
      >
        {isConnected ? 'Online' : 'Offline'}
      </span>

      {/* Tooltip con detalles */}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: '0',
            marginTop: '8px',
            padding: '10px 14px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 1000,
            minWidth: '180px',
            fontSize: '11px',
            color: '#ddd'
          }}
        >
          <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#fff' }}>
            Backend Status
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Status:</span>
            <span style={{ color: isConnected ? '#4CAF50' : '#F44336' }}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Last check:</span>
            <span>{formatTime(healthState.lastCheck)}</span>
          </div>
          {!isConnected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Failures:</span>
                <span style={{ color: '#FF9800' }}>{healthState.consecutiveFailures}</span>
              </div>
              {healthState.lastError && (
                <div style={{ marginTop: '6px', color: '#F44336', fontSize: '10px' }}>
                  Error: {healthState.lastError}
                </div>
              )}
              <div style={{ marginTop: '8px', color: '#888', fontSize: '10px', textAlign: 'center' }}>
                Click to retry
              </div>
            </>
          )}
        </div>
      )}

      {/* CSS para animacion de pulso */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default ConnectionStatus;
