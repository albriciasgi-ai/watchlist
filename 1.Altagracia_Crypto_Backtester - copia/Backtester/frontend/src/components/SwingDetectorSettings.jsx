// src/components/SwingDetectorSettings.jsx
// Settings panel for Swing Detector indicator in Backtester
import React, { useState, useEffect } from "react";

const SwingDetectorSettings = ({
  config,
  onConfigChange,
  onClose,
  symbol
}) => {
  const [localConfig, setLocalConfig] = useState({
    swingBars: 5,
    direction: 'BOTH',
    volumeFilter: {
      enabled: true,
      minZScore: 0,
      lookbackBars: 20
    },
    vwapFilter: {
      enabled: false,
      deviations: [1, 2, 3],
      marginPercent: 20
    },
    arrowSize: 10,
    arrowOffset: 8,
    showVolumeZScore: false,
    showZones: true,
    ...config
  });

  useEffect(() => {
    if (config) {
      setLocalConfig(prev => ({ ...prev, ...config }));
    }
  }, [config]);

  const handleChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleVolumeFilterChange = (key, value) => {
    const newVolumeFilter = { ...localConfig.volumeFilter, [key]: value };
    handleChange('volumeFilter', newVolumeFilter);
  };

  const handleVwapFilterChange = (key, value) => {
    const newVwapFilter = { ...localConfig.vwapFilter, [key]: value };
    handleChange('vwapFilter', newVwapFilter);
  };

  return (
    <div style={{ padding: '16px', maxWidth: '400px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>Swing Detector - {symbol}</h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '4px 8px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Swing Bars */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>
          Swing Bars (N-bar pivot):
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="range"
            min="2"
            max="15"
            value={localConfig.swingBars}
            onChange={(e) => handleChange('swingBars', parseInt(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{
            background: '#2196F3',
            color: 'white',
            padding: '4px 12px',
            borderRadius: '4px',
            fontWeight: 'bold',
            minWidth: '40px',
            textAlign: 'center'
          }}>
            {localConfig.swingBars}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
          Número de velas a cada lado para confirmar swing. Menor = más señales, Mayor = más filtrado.
        </div>
      </div>

      {/* Direction Filter */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>
          Dirección:
        </label>
        <select
          value={localConfig.direction}
          onChange={(e) => handleChange('direction', e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '2px solid #2196F3'
          }}
        >
          <option value="BOTH">BOTH - Mostrar Highs y Lows</option>
          <option value="LONG">LONG - Solo Swing Lows (compras)</option>
          <option value="SHORT">SHORT - Solo Swing Highs (ventas)</option>
        </select>
      </div>

      {/* Volume Filter Section */}
      <div style={{
        background: '#f5f5f5',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <label style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={localConfig.volumeFilter?.enabled !== false}
            onChange={(e) => handleVolumeFilterChange('enabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Filtro de Volumen
        </label>

        {localConfig.volumeFilter?.enabled !== false && (
          <>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                Min Z-Score: <strong>{localConfig.volumeFilter?.minZScore || 0}</strong>
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={localConfig.volumeFilter?.minZScore || 0}
                onChange={(e) => handleVolumeFilterChange('minZScore', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '10px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                <span>0 (sin filtro)</span>
                <span>1.5 (alto)</span>
                <span>3 (muy alto)</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                Lookback Bars: <strong>{localConfig.volumeFilter?.lookbackBars || 20}</strong>
              </label>
              <input
                type="range"
                min="10"
                max="50"
                value={localConfig.volumeFilter?.lookbackBars || 20}
                onChange={(e) => handleVolumeFilterChange('lookbackBars', parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}
      </div>

      {/* VWAP Filter Section */}
      <div style={{
        background: '#e8f5e9',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: localConfig.vwapFilter?.enabled ? '2px solid #4CAF50' : 'none'
      }}>
        <label style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={localConfig.vwapFilter?.enabled || false}
            onChange={(e) => handleVwapFilterChange('enabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Filtro VWAP (requiere VWAP activo)
        </label>

        {localConfig.vwapFilter?.enabled && (
          <>
            <div style={{ fontSize: '11px', color: '#2E7D32', marginBottom: '12px', padding: '8px', background: '#c8e6c9', borderRadius: '4px' }}>
              <strong>Cómo funciona:</strong><br/>
              - Precio cerca de bandas inferiores (-σ) → solo señales LONG<br/>
              - Precio cerca de bandas superiores (+σ) → solo señales SHORT<br/>
              - Precio entre bandas → ambas direcciones permitidas
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                Bandas de desviación a usar:
              </label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                {[1, 2, 3].map(dev => (
                  <label key={dev} style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                    <input
                      type="checkbox"
                      checked={(localConfig.vwapFilter?.deviations || [1, 2, 3]).includes(dev)}
                      onChange={(e) => {
                        const currentDevs = localConfig.vwapFilter?.deviations || [1, 2, 3];
                        const newDevs = e.target.checked
                          ? [...currentDevs, dev].sort()
                          : currentDevs.filter(d => d !== dev);
                        handleVwapFilterChange('deviations', newDevs);
                      }}
                      style={{ marginRight: '4px' }}
                    />
                    {dev}σ
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                Margen de proximidad: <strong>{localConfig.vwapFilter?.marginPercent || 20}%</strong>
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={localConfig.vwapFilter?.marginPercent || 20}
                onChange={(e) => handleVwapFilterChange('marginPercent', parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
                <span>5% (estricto)</span>
                <span>25%</span>
                <span>50% (amplio)</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Visual Options */}
      <div style={{
        background: '#e3f2fd',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Opciones Visuales</h4>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
            Tamaño de flechas: <strong>{localConfig.arrowSize}px</strong>
          </label>
          <input
            type="range"
            min="6"
            max="20"
            value={localConfig.arrowSize}
            onChange={(e) => handleChange('arrowSize', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={localConfig.showVolumeZScore}
              onChange={(e) => handleChange('showVolumeZScore', e.target.checked)}
              style={{ marginRight: '8px' }}
            />
            Mostrar Z-Score en flechas
          </label>
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={localConfig.showZones !== false}
              onChange={(e) => handleChange('showZones', e.target.checked)}
              style={{ marginRight: '8px' }}
            />
            Mostrar zonas de precio
          </label>
        </div>
      </div>

      {/* Info */}
      <div style={{
        background: '#fff3e0',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#666'
      }}>
        <strong>Swing High/Low:</strong> Detecta pivotes locales usando el algoritmo N-bar.
        Un Swing High requiere que la vela tenga el máximo más alto de las N velas anteriores y posteriores.
        Un Swing Low requiere el mínimo más bajo.
      </div>
    </div>
  );
};

export default SwingDetectorSettings;
