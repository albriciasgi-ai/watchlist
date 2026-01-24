// src/components/OrderFlowSettings.jsx
import React, { useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from '../config.js';

/**
 * OrderFlowSettings - Configuration panel for Order Flow Indicator
 *
 * Controls backend service configuration:
 * - Enable/disable service
 * - Number of levels per candle (6 default)
 * - Imbalance threshold (ratio >= 3.0)
 * - Stacked imbalance settings
 * - Alert configuration
 */
const OrderFlowSettings = ({
  config,
  onConfigChange,
  currentSymbol,
  onBackendConfigSaved
}) => {
  // Default config if none provided
  const defaultConfig = {
    enabled: true,
    showPOC: true,
    showImbalances: true,
    showDelta: true
  };

  const [localConfig, setLocalConfig] = useState(config || defaultConfig);
  const [backendStatus, setBackendStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});

  // Fetch backend status on mount
  useEffect(() => {
    fetchBackendStatus();
  }, [currentSymbol]);

  // Update local config when props change
  useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  const fetchBackendStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/status`);
      if (response.ok) {
        const data = await response.json();
        setBackendStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch orderflow status:', error);
    }
  };

  const fetchBackendConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/config`);
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (error) {
      console.error('Failed to fetch orderflow config:', error);
    }
    return null;
  };

  // Handle frontend display config changes (immediate)
  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  // Handle backend config changes (batched)
  const handleBackendConfigUpdate = useCallback((updates) => {
    setPendingChanges(prev => ({ ...prev, ...updates }));
  }, []);

  // Save pending changes to backend
  const handleSaveChanges = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingChanges)
      });

      if (response.ok) {
        console.log('[OrderFlow] Config saved:', Object.keys(pendingChanges));
        await fetchBackendStatus();
        setPendingChanges({});
        if (onBackendConfigSaved) {
          onBackendConfigSaved();
        }
      } else {
        alert('Error al guardar configuracion');
      }
    } catch (error) {
      console.error('[OrderFlow] Config save error:', error);
      alert('Error de conexion al guardar');
    } finally {
      setLoading(false);
    }
  };

  // Discard pending changes
  const handleDiscardChanges = () => {
    setPendingChanges({});
  };

  const hasUnsavedChanges = Object.keys(pendingChanges).length > 0;

  // Get current values (pending changes override backend)
  const getCurrentValue = (key, defaultValue) => {
    if (pendingChanges.hasOwnProperty(key)) {
      return pendingChanges[key];
    }
    if (backendStatus && backendStatus.hasOwnProperty(key)) {
      return backendStatus[key];
    }
    return defaultValue;
  };

  const enabled = getCurrentValue('enabled', true);
  const numLevels = getCurrentValue('num_levels', 6);
  const imbalanceThreshold = getCurrentValue('imbalance_threshold', 3.0);
  const stackedMinLevels = getCurrentValue('stacked_min_levels', 3);
  const alertsEnabled = getCurrentValue('alerts_enabled', true);
  const alertCooldown = getCurrentValue('alert_cooldown_minutes', 15);
  const maxFootprints = getCurrentValue('max_footprints_in_memory', 2880);
  const logTrades = getCurrentValue('log_trades', false);

  return (
    <div className="orderflow-settings" style={{ padding: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#FF5722' }}>
          Order Flow - {currentSymbol}
        </h4>

        {/* Unsaved Changes Banner */}
        {hasUnsavedChanges && (
          <div style={{
            background: '#FFF3E0',
            border: '2px solid #FF9800',
            padding: '10px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}>
            <span style={{ fontSize: '13px', color: '#E65100', fontWeight: 'bold' }}>
              Cambios sin guardar
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleDiscardChanges}
                disabled={loading}
                style={{
                  padding: '6px 12px',
                  background: '#f5f5f5',
                  color: '#666',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Descartar
              </button>
              <button
                onClick={handleSaveChanges}
                disabled={loading}
                style={{
                  padding: '6px 12px',
                  background: loading ? '#FFB74D' : '#FF9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading ? 'default' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
              >
                {loading ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        )}

        {/* Backend Status */}
        {backendStatus && (
          <div style={{
            background: backendStatus.running ? '#e8f5e9' : '#ffebee',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            marginBottom: '12px'
          }}>
            <span style={{ fontWeight: 'bold', color: backendStatus.running ? '#4CAF50' : '#f44336' }}>
              {backendStatus.running ? 'RUNNING' : 'STOPPED'}
            </span>
            {backendStatus.running && (
              <span style={{ marginLeft: '12px', color: '#666' }}>
                Trades: {backendStatus.trades_received || 0} |
                Footprints: {backendStatus.footprints_completed || 0} |
                Alerts: {backendStatus.alerts_sent || 0}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Enable/Disable Service */}
      <div style={{
        marginBottom: '16px',
        padding: '12px',
        background: enabled ? '#e8f5e9' : '#fff3e0',
        borderRadius: '8px',
        border: `2px solid ${enabled ? '#4CAF50' : '#FF9800'}`
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontWeight: 'bold'
        }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleBackendConfigUpdate({ enabled: e.target.checked })}
            disabled={loading}
            style={{ marginRight: '8px', width: '18px', height: '18px' }}
          />
          <span style={{ color: enabled ? '#2E7D32' : '#E65100' }}>
            {enabled ? 'Order Flow Service ENABLED' : 'Order Flow Service DISABLED'}
          </span>
        </label>
      </div>

      {/* Display Settings (Frontend) */}
      <div style={{
        background: '#f5f5f5',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h5 style={{ margin: '0 0 12px 0' }}>Display Settings</h5>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: '8px'
        }}>
          <input
            type="checkbox"
            checked={localConfig.enabled}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Show Order Flow on chart
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: '8px'
        }}>
          <input
            type="checkbox"
            checked={localConfig.showPOC !== false}
            onChange={(e) => handleConfigChange('showPOC', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Show POC (Point of Control) line
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: '8px'
        }}>
          <input
            type="checkbox"
            checked={localConfig.showImbalances !== false}
            onChange={(e) => handleConfigChange('showImbalances', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Highlight imbalances
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={localConfig.showDelta !== false}
            onChange={(e) => handleConfigChange('showDelta', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Show delta values
        </label>
      </div>

      {/* Footprint Parameters (Backend) */}
      <div style={{
        background: '#fff3e0',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #FF9800'
      }}>
        <h5 style={{ margin: '0 0 12px 0', color: '#E65100' }}>Footprint Parameters</h5>

        {/* Number of Levels */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Number of Levels: {numLevels}
          </label>
          <input
            type="range"
            min="3"
            max="12"
            value={numLevels}
            onChange={(e) => handleBackendConfigUpdate({ num_levels: parseInt(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>3 (menos detalle)</span>
            <span>12 (mas detalle)</span>
          </div>
        </div>

        {/* Imbalance Threshold */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Imbalance Threshold: {imbalanceThreshold.toFixed(1)}x
          </label>
          <input
            type="range"
            min="2"
            max="5"
            step="0.5"
            value={imbalanceThreshold}
            onChange={(e) => handleBackendConfigUpdate({ imbalance_threshold: parseFloat(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>2x (mas sensible)</span>
            <span>5x (mas estricto)</span>
          </div>
          <div style={{ fontSize: '10px', color: '#E65100', marginTop: '4px' }}>
            Ratio minimo entre bid y ask para considerar imbalance
          </div>
        </div>

        {/* Stacked Min Levels */}
        <div>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Stacked Imbalance Min Levels: {stackedMinLevels}
          </label>
          <input
            type="range"
            min="2"
            max="6"
            value={stackedMinLevels}
            onChange={(e) => handleBackendConfigUpdate({ stacked_min_levels: parseInt(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>2 (menos consecutivos)</span>
            <span>6 (mas consecutivos)</span>
          </div>
          <div style={{ fontSize: '10px', color: '#E65100', marginTop: '4px' }}>
            Niveles consecutivos con imbalance para generar alerta
          </div>
        </div>
      </div>

      {/* Alert Settings */}
      <div style={{
        background: alertsEnabled ? '#e8f5e9' : '#ffebee',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: `2px solid ${alertsEnabled ? '#4CAF50' : '#f44336'}`
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h5 style={{ margin: 0, color: alertsEnabled ? '#2E7D32' : '#C62828' }}>Alert Settings</h5>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={(e) => handleBackendConfigUpdate({ alerts_enabled: e.target.checked })}
              disabled={loading}
              style={{ marginRight: '6px' }}
            />
            {alertsEnabled ? 'Alerts ON' : 'Alerts OFF'}
          </label>
        </div>

        {alertsEnabled && (
          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
              Alert Cooldown: {alertCooldown} min
            </label>
            <input
              type="range"
              min="1"
              max="60"
              value={alertCooldown}
              onChange={(e) => handleBackendConfigUpdate({ alert_cooldown_minutes: parseInt(e.target.value) })}
              disabled={loading}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
              <span>1 min</span>
              <span>60 min</span>
            </div>
            <div style={{ fontSize: '10px', color: '#2E7D32', marginTop: '4px' }}>
              Tiempo minimo entre alertas del mismo simbolo
            </div>
          </div>
        )}

        {!alertsEnabled && (
          <div style={{ fontSize: '11px', color: '#C62828', fontStyle: 'italic' }}>
            Las alertas de stacked imbalance estan desactivadas
          </div>
        )}
      </div>

      {/* Advanced Settings */}
      <div style={{
        background: '#f5f5f5',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h5 style={{ margin: '0 0 12px 0' }}>Advanced Settings</h5>

        {/* Max Footprints in Memory */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Max Footprints in Memory: {maxFootprints}
          </label>
          <input
            type="range"
            min="500"
            max="5000"
            step="100"
            value={maxFootprints}
            onChange={(e) => handleBackendConfigUpdate({ max_footprints_in_memory: parseInt(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>500</span>
            <span>5000</span>
          </div>
        </div>

        {/* Log Trades */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '12px'
        }}>
          <input
            type="checkbox"
            checked={logTrades}
            onChange={(e) => handleBackendConfigUpdate({ log_trades: e.target.checked })}
            disabled={loading}
            style={{ marginRight: '6px' }}
          />
          Log individual trades (debug mode)
        </label>
        <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', marginLeft: '22px' }}>
          Advertencia: Puede generar muchos logs en alta volatilidad
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={fetchBackendStatus}
          disabled={loading}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '10px',
            background: loading ? '#90CAF9' : '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'default' : 'pointer',
            fontWeight: 'bold',
            fontSize: '12px'
          }}
        >
          {loading ? 'Cargando...' : 'Actualizar Estado'}
        </button>
      </div>

      {/* Info Section */}
      <div style={{
        marginTop: '16px',
        padding: '12px',
        background: '#e3f2fd',
        borderRadius: '8px',
        fontSize: '11px',
        color: '#1565C0'
      }}>
        <strong>Order Flow Footprint</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
          <li><strong>POC</strong>: Nivel con mayor volumen (Point of Control)</li>
          <li><strong>Imbalance</strong>: Nivel donde un lado tiene {imbalanceThreshold}x mas volumen</li>
          <li><strong>Stacked Imbalance</strong>: {stackedMinLevels}+ niveles consecutivos con imbalance en misma direccion</li>
          <li><strong>Delta</strong>: ask_volume - bid_volume (positivo = compradores dominan)</li>
        </ul>
      </div>
    </div>
  );
};

export default OrderFlowSettings;
