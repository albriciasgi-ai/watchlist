// src/components/LiquidationClustersSettings.jsx
import React, { useState, useEffect } from "react";
import "./VWAPSettings.css"; // Reusamos los estilos del VWAP

const LiquidationClustersSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [localConfig, setLocalConfig] = useState(config);

  // Actualizar localConfig cuando cambia el config externo
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  return (
    <div className="vwap-settings"> {/* Reusamos la clase del VWAP */}
      <div className="settings-section">
        <h4 style={{ margin: '0 0 16px 0' }}>
          🔥 Configuración Liquidation Clusters - {currentSymbol}
        </h4>

        {/* Posición de Labels */}
        <div className="setting-row" style={{
          background: '#e8f5e9',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '2px solid #4CAF50'
        }}>
          <label style={{ fontWeight: 'bold', fontSize: '14px', display: 'block', marginBottom: '8px' }}>
            📍 Posición de Labels:
          </label>
          <select
            value={localConfig.labelPosition || 'right'}
            onChange={(e) => handleConfigChange('labelPosition', e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '14px',
              borderRadius: '4px',
              border: '2px solid #4CAF50',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            <option value="right">➡️ Derecha (por defecto)</option>
            <option value="left">⬅️ Izquierda</option>
          </select>
        </div>

        {/* Mostrar Top 3 Líneas */}
        <div className="setting-row" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={localConfig.showTop3Lines !== false}
              onChange={(e) => handleConfigChange('showTop3Lines', e.target.checked)}
              style={{ marginRight: '8px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: '500' }}>🔥 Mostrar Top 3 (líneas completas + labels)</span>
          </label>
          <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
            Los 3 niveles de liquidación más importantes atraviesan el gráfico completo
          </div>
        </div>

        {/* Mostrar Marcadores 4-10 */}
        <div className="setting-row" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={localConfig.showMid7Markers !== false}
              onChange={(e) => handleConfigChange('showMid7Markers', e.target.checked)}
              style={{ marginRight: '8px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: '500' }}>⚡ Mostrar Clusters 4-10 (marcadores)</span>
          </label>
          <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
            Triángulos en el borde derecho con líneas punteadas sutiles
          </div>
        </div>

        {/* Mostrar Sombreado 11-50 */}
        <div className="setting-row" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={localConfig.showRestShading !== false}
              onChange={(e) => handleConfigChange('showRestShading', e.target.checked)}
              style={{ marginRight: '8px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: '500' }}>🌫️ Mostrar Clusters 11-50 (sombreado sutil)</span>
          </label>
          <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
            Zonas muy transparentes que dan contexto de densidad
          </div>
        </div>

        {/* Hint informativo */}
        <div className="settings-hint" style={{
          background: '#fff3e0',
          border: '2px solid #FF9800',
          borderRadius: '8px',
          padding: '12px',
          marginTop: '16px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#F57C00' }}>
            💡 ¿Qué son los Liquidation Clusters?
          </div>
          <div style={{ fontSize: '12px', color: '#555', lineHeight: '1.6' }}>
            Los clusters de liquidación muestran niveles de precio donde hay grandes cantidades de órdenes
            de liquidación pendientes. Estos niveles actúan como "imanes de precio" porque:
            <ul style={{ marginTop: '8px', marginBottom: '8px' }}>
              <li><strong>🔻 LONG liquidations (rojas):</strong> Traders largos con stops bajos → precio tiende a caer para liquidarlos</li>
              <li><strong>🔺 SHORT liquidations (verdes):</strong> Traders cortos con stops altos → precio tiende a subir para liquidarlos</li>
            </ul>
            <strong>Magnetic Strength:</strong> Combina volumen (70%) y proximidad al precio actual (30%)
          </div>
        </div>

        {/* Info de datos */}
        <div style={{
          background: '#e3f2fd',
          border: '2px solid #2196F3',
          borderRadius: '8px',
          padding: '12px',
          marginTop: '12px',
          fontSize: '12px',
          color: '#555'
        }}>
          <strong>📊 Fuente de datos:</strong> MarginPad API (100% gratis, sin autenticación)<br/>
          <strong>🔄 Actualización:</strong> Cada 2 minutos<br/>
          <strong>💾 Cache:</strong> 60 segundos
        </div>
      </div>
    </div>
  );
};

export default LiquidationClustersSettings;
