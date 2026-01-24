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
  const [symbolStepSize, setSymbolStepSize] = useState(null);
  const [defaultStepSize, setDefaultStepSize] = useState(null);
  const [allDefaultStepSizes, setAllDefaultStepSizes] = useState({});
  const [pendingStepSize, setPendingStepSize] = useState(null);

  // Fetch backend status and symbol step size on mount/symbol change
  useEffect(() => {
    fetchBackendStatus();
    fetchSymbolStepSize();
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

  const fetchSymbolStepSize = async () => {
    if (!currentSymbol) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/step-size/${currentSymbol}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSymbolStepSize(data.step_size);
          setDefaultStepSize(data.default_step_size);
          setAllDefaultStepSizes(data.all_defaults || {});
          setPendingStepSize(null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch symbol step size:', error);
    }
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
  const imbalanceThreshold = getCurrentValue('imbalance_threshold', 3.0);
  const stackedMinLevels = getCurrentValue('stacked_min_levels', 3);
  const alertsEnabled = getCurrentValue('alerts_enabled', true);
  const alertCooldown = getCurrentValue('alert_cooldown_minutes', 15);
  const maxFootprints = getCurrentValue('max_footprints_in_memory', 2880);
  const logTrades = getCurrentValue('log_trades', false);

  // Current step size value (pending overrides actual)
  const currentStepSize = pendingStepSize !== null ? pendingStepSize : (symbolStepSize || defaultStepSize || 1);

  const handleStepSizeChange = (value) => {
    setPendingStepSize(value);
  };

  const hasUnsavedStepSize = pendingStepSize !== null && pendingStepSize !== symbolStepSize;

  const handleSaveStepSize = async () => {
    if (!hasUnsavedStepSize || !currentSymbol) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/step-size/${currentSymbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_size: pendingStepSize })
      });

      if (response.ok) {
        console.log(`[OrderFlow] Step size saved for ${currentSymbol}: ${pendingStepSize}`);
        setSymbolStepSize(pendingStepSize);
        setPendingStepSize(null);
        if (onBackendConfigSaved) {
          onBackendConfigSaved();
        }
      } else {
        alert('Error al guardar step size');
      }
    } catch (error) {
      console.error('[OrderFlow] Step size save error:', error);
      alert('Error de conexion al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleResetStepSize = () => {
    setPendingStepSize(defaultStepSize);
  };

  const handleDiscardStepSize = () => {
    setPendingStepSize(null);
  };

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
          cursor: 'pointer',
          marginBottom: '12px'
        }}>
          <input
            type="checkbox"
            checked={localConfig.showDelta !== false}
            onChange={(e) => handleConfigChange('showDelta', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Show delta values
        </label>

        {/* History Hours */}
        <div>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Horas de historial: {localConfig.historyHours || 12}h
          </label>
          <input
            type="range"
            min="1"
            max="24"
            value={localConfig.historyHours || 12}
            onChange={(e) => handleConfigChange('historyHours', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>1h</span>
            <span>24h</span>
          </div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            Cantidad de horas de footprints a cargar. Mas horas = mas datos pero carga mas lenta.
          </div>
        </div>
      </div>

      {/* Step Size Configuration - Per Symbol */}
      <div style={{
        background: '#E3F2FD',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #2196F3'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h5 style={{ margin: 0, color: '#1565C0' }}>
            Step Size - {currentSymbol}
          </h5>
          {hasUnsavedStepSize && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handleDiscardStepSize}
                disabled={loading}
                style={{
                  padding: '4px 8px',
                  background: '#f5f5f5',
                  color: '#666',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Descartar
              </button>
              <button
                onClick={handleSaveStepSize}
                disabled={loading}
                style={{
                  padding: '4px 8px',
                  background: loading ? '#64B5F6' : '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading ? 'default' : 'pointer',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}
              >
                {loading ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
        <div style={{ fontSize: '11px', color: '#1976D2', marginBottom: '12px' }}>
          Tamano de cada nivel de precio en USD. Todos los niveles tendran este tamano fijo.
        </div>

        {/* Step Size Input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Step Size: ${currentStepSize} USD
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              min="0.001"
              max="100"
              step="0.1"
              value={currentStepSize}
              onChange={(e) => handleStepSizeChange(parseFloat(e.target.value) || 0.1)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '8px',
                border: '1px solid #90CAF9',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            />
            <button
              onClick={handleResetStepSize}
              disabled={loading}
              style={{
                padding: '8px 12px',
                background: '#f5f5f5',
                color: '#666',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px'
              }}
              title={`Reset to default: $${defaultStepSize}`}
            >
              Reset
            </button>
          </div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            Default para {currentSymbol}: ${defaultStepSize} USD
          </div>
        </div>

        {/* Common Presets */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '6px', fontSize: '11px', color: '#1565C0' }}>
            Presets rapidos:
          </label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[0.5, 1, 2, 5, 10, 20, 50].map(preset => (
              <button
                key={preset}
                onClick={() => handleStepSizeChange(preset)}
                disabled={loading}
                style={{
                  padding: '4px 10px',
                  background: currentStepSize === preset ? '#2196F3' : '#E3F2FD',
                  color: currentStepSize === preset ? 'white' : '#1565C0',
                  border: '1px solid #90CAF9',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: currentStepSize === preset ? 'bold' : 'normal'
                }}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '10px', color: '#1565C0', marginTop: '8px', background: '#BBDEFB', padding: '8px', borderRadius: '4px' }}>
          <strong>Como funciona:</strong><br/>
          - Cada nivel tiene exactamente ${currentStepSize} de alto<br/>
          - Velas grandes tendran MAS niveles, velas pequenas MENOS<br/>
          - Los niveles estan ALINEADOS entre velas (mismo precio = misma posicion Y)<br/>
          - Similar a ATAS, Sierra Chart y plataformas profesionales
        </div>
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
        <strong>Order Flow Footprint (Step Size Absoluto)</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
          <li><strong>Step Size</strong>: Tamano fijo de cada nivel (${currentStepSize} USD para {currentSymbol})</li>
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
