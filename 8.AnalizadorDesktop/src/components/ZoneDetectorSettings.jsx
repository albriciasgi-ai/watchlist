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
  max_price_range_pct: 5.0,
  entry_mode: "breakout_close",
  position_mode: "sequential",
  swing_bars: 5,
  sl_mode: "zone_opposite"
};

// Limites maximos de dias por timeframe (debe coincidir con backend)
const MAX_DAYS_BY_INTERVAL = {
  "1": 5, "3": 10, "5": 120, "15": 90, "30": 150,
  "60": 360, "120": 180, "240": 720, "D": 1440, "W": 730
};

// Dias por defecto para deteccion de zonas (mas alto que el chart)
const DEFAULT_ZONE_DAYS_BY_INTERVAL = {
  "1": 3, "3": 7, "5": 30, "15": 60, "30": 90,
  "60": 180, "120": 180, "240": 360, "D": 730, "W": 730
};

// Campos que son strings (no numericos) - fuera del componente para estabilidad
const STRING_PARAMS = ['entry_mode', 'position_mode', 'sl_mode'];

function ZoneDetectorSettings({ isOpen, onClose, indicatorManager, onZonesLoaded, symbol, interval }) {
  const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 120;
  const defaultDays = DEFAULT_ZONE_DAYS_BY_INTERVAL[interval] || 30;

  const [params, setParams] = useState(defaultParams);
  const [zoneDays, setZoneDays] = useState(defaultDays);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, message }
  const [stats, setStats] = useState(null);
  const [candlesCount, setCandlesCount] = useState(null);
  const [csvPath, setCsvPath] = useState(null);
  const [error, setError] = useState(null);

  const handleParamChange = useCallback((key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: STRING_PARAMS.includes(key) ? value : (typeof value === 'string' ? parseFloat(value) || 0 : value)
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
    console.log(`[ZoneDetector] handleDetect: manager=${!!manager}, symbol=${symbol}, interval=${interval}, days=${zoneDays}`);
    if (!manager) {
      setError('IndicatorManager no disponible. Espera a que el grafico cargue.');
      return;
    }

    setLoading(true);
    setError(null);
    setCsvPath(null);
    setCandlesCount(null);
    setProgress({ phase: 'starting', message: 'Iniciando deteccion...' });

    const intervalMinutes = {1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60;
    const expectedCandles = Math.ceil((zoneDays * 24 * 60) / intervalMinutes);
    console.log(`[ZoneDetector] Esperando ~${expectedCandles} velas (${zoneDays} dias en ${interval}m)`);
    console.log(`[ZoneDetector] PARAMS enviados:`, JSON.stringify({entry_mode: params.entry_mode, position_mode: params.position_mode, swing_bars: params.swing_bars}));

    try {
      const startTime = Date.now();

      // Timer para mostrar tiempo transcurrido
      const timer = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        setProgress(prev => prev ? {
          ...prev,
          message: `${prev.phase === 'fetching' ? 'Descargando' : 'Procesando'} ~${expectedCandles} velas (${elapsed}s)...`
        } : null);
      }, 1000);

      const result = await manager.loadTradingZones({
        ...params,
        days: zoneDays,
        generate_csv: true,
        _onProgress: (p) => setProgress(p)
      });

      clearInterval(timer);

      if (result.success) {
        setStats(result.stats);
        setCandlesCount(result.candles_count || null);
        setCsvPath(result.csv_path);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        setProgress({ phase: 'done', message: `Completado en ${elapsed}s` });
        if (onZonesLoaded) {
          onZonesLoaded(result);
        }
      } else {
        setError(result.error || 'Error detectando zonas');
        setProgress(null);
      }
    } catch (err) {
      console.error(`[ZoneDetector] ERROR:`, err.name, err.message, err);
      setError(err.message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [getManager, params, zoneDays, onZonesLoaded, interval, symbol]);

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
          {/* Periodo de analisis */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Periodo de Analisis</h4>
            <div style={styles.row}>
              <label style={styles.label}>Dias a analizar:</label>
              <input
                type="number"
                style={{...styles.input, width: '80px'}}
                value={zoneDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1;
                  setZoneDays(Math.min(Math.max(v, 1), maxDays));
                }}
                min="1"
                max={maxDays}
              />
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '2px'}}>
              ~{Math.ceil((zoneDays * 24 * 60) / ({1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080}[interval] || 60))} velas
              {' '}(max {maxDays} dias para {interval}m)
            </div>
          </div>

          {/* Parámetros de consolidación */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Parametros de Consolidacion</h4>

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
            <h4 style={styles.sectionTitle}>Simulacion de Trade</h4>

            <div style={styles.row}>
              <label style={styles.label}>Modo de Entrada:</label>
              <select
                style={{...styles.input, width: '150px', textAlign: 'left'}}
                value={params.entry_mode}
                onChange={(e) => handleParamChange('entry_mode', e.target.value)}
              >
                <option value="breakout_close">Close del Breakout</option>
                <option value="swing_confirmation">Swing Confirmation</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              {params.entry_mode === 'breakout_close'
                ? 'Entrada al precio de cierre de la vela de breakout'
                : 'Entrada al confirmarse el swing (pullback) post-breakout'}
            </div>

            {params.entry_mode === 'swing_confirmation' && (
              <div style={styles.row}>
                <label style={styles.label}>Swing Bars:</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.swing_bars}
                  onChange={(e) => handleParamChange('swing_bars', parseInt(e.target.value))}
                  min="2"
                  max="10"
                />
              </div>
            )}

            <div style={styles.row}>
              <label style={styles.label}>Modo de Posicion:</label>
              <select
                style={{...styles.input, width: '150px', textAlign: 'left'}}
                value={params.position_mode}
                onChange={(e) => handleParamChange('position_mode', e.target.value)}
              >
                <option value="sequential">Sequential (1 a la vez)</option>
                <option value="concurrent">Concurrent (simultaneas)</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              {params.position_mode === 'sequential'
                ? 'Solo un trade abierto a la vez (realista)'
                : 'Multiples trades simultaneos'}
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Modo de StopLoss:</label>
              <select
                style={{...styles.input, width: '150px', textAlign: 'left'}}
                value={params.sl_mode}
                onChange={(e) => handleParamChange('sl_mode', e.target.value)}
              >
                <option value="zone_opposite">Lado opuesto del rango</option>
                <option value="swing_previous">Swing H/L anterior</option>
              </select>
            </div>
            <div style={{fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px'}}>
              {params.sl_mode === 'zone_opposite'
                ? 'SL a 1R del entry (R = altura del rango)'
                : 'SL al swing high/low anterior al breakout'}
            </div>

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
              {loading ? 'Detectando...' : 'Detectar Zonas'}
            </button>
            <button
              style={styles.clearBtn}
              onClick={handleClear}
            >
              🗑️ Limpiar
            </button>
          </div>

          {/* Progreso */}
          {progress && (
            <div style={styles.progressBar}>
              <div style={{fontSize: '12px', color: '#B0B0B0', marginBottom: '4px'}}>
                {progress.message}
              </div>
              {loading && (
                <div style={{height: '3px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden'}}>
                  <div style={{
                    height: '100%',
                    backgroundColor: '#4A6FA5',
                    borderRadius: '2px',
                    width: progress.phase === 'done' ? '100%' : '60%',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={styles.error}>
              ❌ {error}
            </div>
          )}

          {/* Estadísticas */}
          {stats && (
            <div style={styles.stats}>
              <h4 style={styles.sectionTitle}>Resultados</h4>
              {candlesCount && (
                <div style={{fontSize: '11px', color: '#888', marginBottom: '4px'}}>
                  {candlesCount.toLocaleString()} velas analizadas ({zoneDays} dias, {interval}m)
                </div>
              )}
              {stats.entry_mode && (
                <div style={{fontSize: '11px', color: '#666', marginBottom: '8px'}}>
                  Entrada: {stats.entry_mode === 'breakout_close' ? 'Close Breakout' : 'Swing Confirmation'}
                  {' | '}Pos: {stats.position_mode === 'sequential' ? 'Sequential' : 'Concurrent'}
                </div>
              )}
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
                  <span style={styles.statLabel}>Expectancy:</span>
                  <span style={{...styles.statValue, color: (stats.expectancy || 0) >= 0 ? '#4CAF50' : '#FF5722'}}>
                    {(stats.expectancy || 0) > 0 ? '+' : ''}{(stats.expectancy || 0).toFixed(3)}R
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Open:</span>
                  <span style={{...styles.statValue, color: '#FFC107'}}>{stats.open}</span>
                </div>
                {(stats.skipped > 0 || stats.no_entry > 0) && (
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>Skipped / No Entry:</span>
                    <span style={{...styles.statValue, color: '#888'}}>
                      {stats.skipped || 0} / {stats.no_entry || 0}
                    </span>
                  </div>
                )}
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
  progressBar: {
    marginBottom: '12px',
    padding: '8px 0'
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
