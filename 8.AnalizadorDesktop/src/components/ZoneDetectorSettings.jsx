// ZoneDetectorSettings.jsx
// Panel para configurar y ejecutar la detección de zonas de trading

import React, { useState, useCallback } from 'react';
import IndicatorManagerRegistry from '../utils/IndicatorManagerRegistry';

const defaultParams = {
  consol_min_bars: 8,
  consol_max_bars: 50,
  consol_max_range_pct: 2.0,
  consol_atr_ratio: 0.6,
  consol_body_ratio: 0.5,
  consol_max_outside_bars: 3,
  lookforward_bars: 100,
  max_price_range_pct: 5.0
};

function ZoneDetectorSettings({ isOpen, onClose, indicatorManager, onZonesLoaded, symbol }) {
  const [params, setParams] = useState(defaultParams);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [csvPath, setCsvPath] = useState(null);
  const [error, setError] = useState(null);

  const handleParamChange = useCallback((key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: typeof value === 'string' ? parseFloat(value) || 0 : value
    }));
  }, []);

  // Obtener el manager de props o del Registry
  const getManager = useCallback(() => {
    if (indicatorManager) return indicatorManager;
    if (symbol) return IndicatorManagerRegistry.get(symbol);
    return null;
  }, [indicatorManager, symbol]);

  const handleDetect = useCallback(async () => {
    const manager = getManager();
    if (!manager) {
      setError('IndicatorManager no disponible. Espera a que el gráfico cargue.');
      return;
    }

    setLoading(true);
    setError(null);
    setCsvPath(null);

    try {
      const result = await manager.loadTradingZones({
        ...params,
        generate_csv: true
      });

      if (result.success) {
        setStats(result.stats);
        setCsvPath(result.csv_path);
        if (onZonesLoaded) {
          onZonesLoaded(result);
        }
      } else {
        setError(result.error || 'Error detectando zonas');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getManager, params, onZonesLoaded]);

  const handleClear = useCallback(() => {
    const manager = getManager();
    if (manager) {
      manager.clearTradingZones();
      setStats(null);
      setCsvPath(null);
    }
  }, [getManager]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>🎯 Detector de Zonas</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.content}>
          {/* Parámetros de consolidación */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Parámetros de Consolidación</h4>

            <div style={styles.row}>
              <label style={styles.label}>Min Barras:</label>
              <input
                type="number"
                style={styles.input}
                value={params.consol_min_bars}
                onChange={(e) => handleParamChange('consol_min_bars', parseInt(e.target.value))}
                min="3"
                max="30"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Max Barras:</label>
              <input
                type="number"
                style={styles.input}
                value={params.consol_max_bars}
                onChange={(e) => handleParamChange('consol_max_bars', parseInt(e.target.value))}
                min="10"
                max="200"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Max Rango %:</label>
              <input
                type="number"
                style={styles.input}
                value={params.consol_max_range_pct}
                onChange={(e) => handleParamChange('consol_max_range_pct', e.target.value)}
                step="0.1"
                min="0.5"
                max="10"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>ATR Ratio:</label>
              <input
                type="number"
                style={styles.input}
                value={params.consol_atr_ratio}
                onChange={(e) => handleParamChange('consol_atr_ratio', e.target.value)}
                step="0.1"
                min="0.1"
                max="2"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Body Ratio:</label>
              <input
                type="number"
                style={styles.input}
                value={params.consol_body_ratio}
                onChange={(e) => handleParamChange('consol_body_ratio', e.target.value)}
                step="0.1"
                min="0.1"
                max="1"
              />
            </div>
          </div>

          {/* Parámetros de simulación */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Simulación de Trade</h4>

            <div style={styles.row}>
              <label style={styles.label}>Lookforward Bars:</label>
              <input
                type="number"
                style={styles.input}
                value={params.lookforward_bars}
                onChange={(e) => handleParamChange('lookforward_bars', parseInt(e.target.value))}
                min="20"
                max="500"
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Max Price Range %:</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_price_range_pct}
                onChange={(e) => handleParamChange('max_price_range_pct', e.target.value)}
                step="0.5"
                min="1"
                max="20"
              />
            </div>
          </div>

          {/* Botones de acción */}
          <div style={styles.actions}>
            <button
              style={styles.detectBtn}
              onClick={handleDetect}
              disabled={loading}
            >
              {loading ? '⏳ Detectando...' : '🔍 Detectar Zonas'}
            </button>
            <button
              style={styles.clearBtn}
              onClick={handleClear}
            >
              🗑️ Limpiar
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={styles.error}>
              ❌ {error}
            </div>
          )}

          {/* Estadísticas */}
          {stats && (
            <div style={styles.stats}>
              <h4 style={styles.sectionTitle}>📊 Resultados</h4>
              <div style={styles.statsGrid}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Total Zonas:</span>
                  <span style={styles.statValue}>{stats.total_zones}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Win Rate:</span>
                  <span style={{...styles.statValue, color: stats.win_rate >= 50 ? '#4CAF50' : '#FF5722'}}>
                    {stats.win_rate}%
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Wins:</span>
                  <span style={{...styles.statValue, color: '#4CAF50'}}>{stats.wins}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Losses:</span>
                  <span style={{...styles.statValue, color: '#FF5722'}}>{stats.losses}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>P&L Total:</span>
                  <span style={{...styles.statValue, color: stats.total_pnl_r >= 0 ? '#4CAF50' : '#FF5722'}}>
                    {stats.total_pnl_r > 0 ? '+' : ''}{stats.total_pnl_r}R
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Open:</span>
                  <span style={{...styles.statValue, color: '#FFC107'}}>{stats.open}</span>
                </div>
              </div>
            </div>
          )}

          {/* CSV Path */}
          {csvPath && (
            <div style={styles.csvInfo}>
              📁 CSV guardado: <code style={styles.code}>{csvPath}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: '#1E1E2E',
    borderRadius: '8px',
    width: '400px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    backgroundColor: '#252536'
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: '#E0E0E0'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#888',
    cursor: 'pointer',
    padding: '0 4px'
  },
  content: {
    padding: '16px'
  },
  section: {
    marginBottom: '16px'
  },
  sectionTitle: {
    fontSize: '14px',
    color: '#B0B0B0',
    marginBottom: '8px',
    marginTop: 0
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  label: {
    fontSize: '13px',
    color: '#A0A0A0'
  },
  input: {
    width: '80px',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #444',
    backgroundColor: '#2A2A3A',
    color: '#E0E0E0',
    fontSize: '13px',
    textAlign: 'right'
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px'
  },
  detectBtn: {
    flex: 1,
    padding: '10px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#4A6FA5',
    color: 'white',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  clearBtn: {
    padding: '10px 16px',
    borderRadius: '4px',
    border: '1px solid #555',
    backgroundColor: 'transparent',
    color: '#A0A0A0',
    fontSize: '14px',
    cursor: 'pointer'
  },
  error: {
    backgroundColor: 'rgba(255, 87, 34, 0.1)',
    border: '1px solid #FF5722',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#FF5722',
    fontSize: '13px',
    marginBottom: '12px'
  },
  stats: {
    backgroundColor: '#252536',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '12px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px'
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px'
  },
  statLabel: {
    color: '#888'
  },
  statValue: {
    color: '#E0E0E0',
    fontWeight: 'bold'
  },
  csvInfo: {
    backgroundColor: '#252536',
    borderRadius: '4px',
    padding: '8px 12px',
    fontSize: '12px',
    color: '#A0A0A0'
  },
  code: {
    backgroundColor: '#1A1A2A',
    padding: '2px 6px',
    borderRadius: '2px',
    fontSize: '11px',
    color: '#4FC3F7'
  }
};

export default ZoneDetectorSettings;
