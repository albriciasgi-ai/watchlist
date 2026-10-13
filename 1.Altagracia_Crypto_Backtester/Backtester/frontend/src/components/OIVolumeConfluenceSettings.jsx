// src/components/OIVolumeConfluenceSettings.jsx
import React, { useState, useEffect } from "react";
import "./OIVolumeConfluenceSettings.css";

const OIVolumeConfluenceSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localConfig, setLocalConfig] = useState(config || {});

  // Sincronizar config local con prop
  useEffect(() => {
    setLocalConfig(config || {});
  }, [config]);

  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleNestedConfigChange = (parentKey, childKey, value) => {
    const newConfig = {
      ...localConfig,
      [parentKey]: {
        ...localConfig[parentKey],
        [childKey]: value
      }
    };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  return (
    <div className="oivolume-confluence-settings">
      <div className="settings-section">
        <h4 style={{ margin: '0 0 16px 0' }}>
          Configuración OI-Volume Confluence - {currentSymbol}
        </h4>

        {/* Cluster Detection - Feature destacada */}
        <div className="setting-row" style={{
          background: '#e8f5e9',
          padding: '14px',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '2px solid #4CAF50'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px'
          }}>
            <input
              type="checkbox"
              checked={localConfig.detectClusters !== false}
              onChange={(e) => handleConfigChange('detectClusters', e.target.checked)}
              style={{ marginRight: '10px', cursor: 'pointer', transform: 'scale(1.2)' }}
            />
            🎯 Detectar Clusters de OI + Volumen
          </label>
          <div style={{
            fontSize: '12px',
            color: '#555',
            marginTop: '8px',
            marginLeft: '32px',
            background: 'white',
            padding: '8px',
            borderRadius: '4px'
          }}>
            Resalta zonas donde hay múltiples señales consecutivas fuertes de confluencia.
            Útil para identificar niveles de soporte/resistencia con alto respaldo institucional.
          </div>

          {/* Cluster threshold */}
          {localConfig.detectClusters !== false && (
            <div style={{ marginTop: '12px', marginLeft: '32px' }}>
              <label style={{ fontSize: '13px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
                Mínimo de barras consecutivas para cluster:
              </label>
              <input
                type="number"
                min="2"
                max="10"
                value={localConfig.clusterMinBars || 3}
                onChange={(e) => handleConfigChange('clusterMinBars', parseInt(e.target.value))}
                style={{
                  width: '80px',
                  padding: '6px',
                  fontSize: '14px',
                  border: '2px solid #4CAF50',
                  borderRadius: '4px',
                  fontWeight: 'bold'
                }}
              />
              <span style={{ marginLeft: '8px', fontSize: '12px', color: '#666' }}>
                (Recomendado: 3-5)
              </span>
            </div>
          )}
        </div>

        {/* Filtros de Señales */}
        <div style={{
          background: '#e3f2fd',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '2px solid #2196F3'
        }}>
          <h5 style={{ margin: '0 0 12px 0', color: '#1976D2' }}>
            📊 Filtros de Señales
          </h5>

          {/* Min Volume Z-Score */}
          <div className="setting-row" style={{ marginBottom: '10px' }}>
            <label>Mín. Z-Score Volumen:</label>
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={localConfig.minVolumeZScore || 0.5}
              onChange={(e) => handleConfigChange('minVolumeZScore', parseFloat(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>
              (0 = sin filtro)
            </span>
          </div>

          {/* Min OI Z-Score */}
          <div className="setting-row" style={{ marginBottom: '10px' }}>
            <label>Mín. Z-Score OI:</label>
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={localConfig.minOIZScore || 0.5}
              onChange={(e) => handleConfigChange('minOIZScore', parseFloat(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>
              (0 = sin filtro)
            </span>
          </div>

          {/* Min Strength */}
          <div className="setting-row">
            <label>Mín. Strength (fuerza):</label>
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={localConfig.minStrength || 0.5}
              onChange={(e) => handleConfigChange('minStrength', parseFloat(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>
              (valor absoluto del score)
            </span>
          </div>

          <div style={{
            fontSize: '11px',
            color: '#555',
            marginTop: '10px',
            background: 'white',
            padding: '8px',
            borderRadius: '4px'
          }}>
            💡 Valores más altos = menos barras pero más significativas (como Volume Delta filtrado)
          </div>
        </div>

        {/* Visualización */}
        <div style={{
          background: '#fff3e0',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '2px solid #FF9800'
        }}>
          <h5 style={{ margin: '0 0 12px 0', color: '#F57C00' }}>
            🎨 Visualización
          </h5>

          {/* Altura del indicador */}
          <div className="setting-row" style={{ marginBottom: '10px' }}>
            <label>Altura del indicador:</label>
            <input
              type="number"
              min="60"
              max="200"
              step="10"
              value={localConfig.height || 100}
              onChange={(e) => handleConfigChange('height', parseInt(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>
              px
            </span>
          </div>

          {/* Grosor de barras */}
          <div className="setting-row">
            <label>Ancho de barras:</label>
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.05"
              value={localConfig.barWidthRatio || 0.9}
              onChange={(e) => handleConfigChange('barWidthRatio', parseFloat(e.target.value))}
              style={{ width: '150px', cursor: 'pointer' }}
            />
            <span style={{ marginLeft: '8px', fontWeight: 'bold', fontSize: '13px' }}>
              {((localConfig.barWidthRatio || 0.9) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Avanzado */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              width: '100%',
              padding: '12px',
              background: showAdvanced ? '#4CAF50' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px'
            }}
          >
            {showAdvanced ? '▼' : '▶'} Configuración Avanzada
          </button>
        </div>

        {showAdvanced && (
          <div style={{
            marginTop: '16px',
            padding: '16px',
            background: '#f5f5f5',
            borderRadius: '8px',
            border: '2px solid #9E9E9E'
          }}>
            {/* Lookback Period */}
            <div className="setting-row" style={{ marginBottom: '12px' }}>
              <label style={{ fontWeight: 'bold' }}>Lookback Period (Z-Score):</label>
              <input
                type="number"
                min="10"
                max="100"
                value={localConfig.lookbackPeriod || 20}
                onChange={(e) => handleConfigChange('lookbackPeriod', parseInt(e.target.value))}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>
                velas (ventana para calcular media y desviación)
              </span>
            </div>

            {/* Colores */}
            <h6 style={{ margin: '16px 0 12px 0', color: '#666' }}>🌈 Colores de Barras</h6>

            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label>Confluencia Alcista:</label>
              <input
                type="color"
                value={localConfig.colors?.bullish || '#34C759'}
                onChange={(e) => handleNestedConfigChange('colors', 'bullish', e.target.value)}
                style={{ width: '60px', height: '30px', cursor: 'pointer', border: 'none', borderRadius: '4px' }}
              />
              <span style={{ marginLeft: '8px', fontSize: '12px', fontFamily: 'monospace' }}>
                {localConfig.colors?.bullish || '#34C759'}
              </span>
            </div>

            <div className="setting-row">
              <label>Confluencia Bajista:</label>
              <input
                type="color"
                value={localConfig.colors?.bearish || '#FF3B30'}
                onChange={(e) => handleNestedConfigChange('colors', 'bearish', e.target.value)}
                style={{ width: '60px', height: '30px', cursor: 'pointer', border: 'none', borderRadius: '4px' }}
              />
              <span style={{ marginLeft: '8px', fontSize: '12px', fontFamily: 'monospace' }}>
                {localConfig.colors?.bearish || '#FF3B30'}
              </span>
            </div>
          </div>
        )}

        <div className="settings-hint" style={{
          marginTop: '16px',
          padding: '12px',
          background: '#e8eaf6',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#3f51b5',
          border: '1px solid #c5cae9'
        }}>
          💡 <strong>OI-Volume Confluence</strong> muestra solo cuando Open Interest y Volumen
          se mueven juntos en la misma dirección: <strong style={{color: '#34C759'}}>Verde</strong> = ambos alcistas (respaldo institucional fuerte para subida),
          <strong style={{color: '#FF3B30'}}> Rojo</strong> = ambos bajistas (respaldo institucional fuerte para caída).
          Los clusters indican zonas de alto respaldo institucional.
        </div>
      </div>
    </div>
  );
};

export default OIVolumeConfluenceSettings;
