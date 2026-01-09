// frontend/src/components/RangeDetectionSettings.jsx
// 🎯 Panel de configuración para Range Detection System

import React, { useState, useEffect } from 'react';

const RangeDetectionSettings = ({ symbol, indicatorManager, candles, onClose }) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [config, setConfig] = useState({
    minRangeLength: 20,
    atrMultiplier: 1.0,
    atrLength: 200,
    maxActiveRanges: 10,
    autoCreateFixedRange: true,
    maxBreakoutCandles: 5,      // 🎯 Máximo de velas fuera antes de finalizar rango
    createTrendProfiles: false, // 🎯 Crear VP entre rangos (tendencias)
    showOtherTimeframes: false  // 🎯 NUEVO: Mostrar rangos de otros timeframes
  });

  const [dateFilterEnabled, setDateFilterEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (indicatorManager) {
      setIsEnabled(indicatorManager.isRangeDetectionEnabled());

      if (indicatorManager.rangeDetector) {
        setConfig(indicatorManager.rangeDetector.config);
      }
    }
  }, [indicatorManager]);

  const handleToggle = () => {
    if (!indicatorManager) return;

    if (isEnabled) {
      indicatorManager.disableRangeDetection();
      setIsEnabled(false);
    } else {
      indicatorManager.enableRangeDetection(config);
      setIsEnabled(true);

      // 🎯 NUEVO: Ejecutar análisis inmediatamente después de habilitar
      if (candles && candles.length > 0) {
        console.log(`[${symbol}] 🚀 Ejecutando análisis inicial con ${candles.length} velas`);
        setTimeout(() => {
          indicatorManager.analyzeRanges(candles);
        }, 500);
      }
    }
  };

  const handleConfigChange = (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);

    if (isEnabled && indicatorManager) {
      indicatorManager.updateRangeDetectionConfig(newConfig);

      // 🎯 NUEVO: Si se activa/desactiva createTrendProfiles, gestionar VP de tendencia
      if (key === 'createTrendProfiles') {
        if (value === true) {
          console.log(`[${symbol}] 📊 createTrendProfiles activado - creando VP de tendencia...`);
          setTimeout(() => {
            indicatorManager.createTrendProfilesBetweenRanges();
          }, 100);
        } else {
          console.log(`[${symbol}] 🗑️ createTrendProfiles desactivado - eliminando VP de tendencia...`);
          // Eliminar VP de tendencia existentes
          setTimeout(() => {
            const trendProfiles = indicatorManager.fixedRangeProfiles
              .filter(p => p.isTrendProfile && p.symbol === symbol);
            trendProfiles.forEach(p => {
              indicatorManager.deleteFixedRangeProfile(p.rangeId);
            });
            indicatorManager.saveFixedRangeProfilesToStorage();
          }, 100);
        }
      }
    }
  };

  const handleDateFilterApply = () => {
    if (!indicatorManager || !startDate || !endDate) return;

    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();

    indicatorManager.setRangeDetectionDateFilter(startTimestamp, endTimestamp);
    setDateFilterEnabled(true);

    // 🎯 NUEVO: Si el detector está habilitado, ejecutar análisis con el nuevo filtro
    if (isEnabled && candles && candles.length > 0) {
      console.log(`[${symbol}] 🔄 Filtro aplicado - re-analizando con ${candles.length} velas`);
      setTimeout(() => {
        indicatorManager.analyzeRanges(candles);
      }, 500);
    }
  };

  const handleDateFilterClear = () => {
    if (!indicatorManager) return;

    indicatorManager.clearRangeDetectionDateFilter();
    setDateFilterEnabled(false);
    setStartDate('');
    setEndDate('');
  };

  const handleClearAutoRanges = () => {
    if (!indicatorManager) return;

    if (confirm(`¿Eliminar todos los rangos auto-detectados de ${symbol}?`)) {
      indicatorManager.clearAutoDetectedRanges();
    }
  };

  const handleToggleRange = (rangeId, currentlyEnabled) => {
    if (!indicatorManager) return;

    // Encontrar el indicador y el perfil
    const indicator = indicatorManager.fixedRangeIndicators.find(ind => ind.rangeId === rangeId);
    const profile = indicatorManager.fixedRangeProfiles.find(p => p.rangeId === rangeId);

    if (indicator && profile) {
      // Toggle enabled
      indicator.enabled = !currentlyEnabled;
      profile.enabled = !currentlyEnabled;

      // Guardar cambios
      indicatorManager.saveFixedRangeProfilesToStorage();

      // Forzar re-render (haciendo que React detecte el cambio)
      setConfig({ ...config });
    }
  };

  const autoRanges = indicatorManager ? indicatorManager.getAutoDetectedRanges() : [];

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'white',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      zIndex: 10000,
      maxWidth: '600px',
      maxHeight: '80vh',
      overflow: 'auto'
    }}>
      <h3 style={{ marginTop: 0 }}>🎯 Range Detection - {symbol}</h3>

      {/* Toggle principal */}
      <div style={{ marginBottom: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '4px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggle}
            style={{ marginRight: '10px', width: '20px', height: '20px' }}
          />
          <strong>Habilitar detección automática de rangos</strong>
        </label>
        <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', marginBottom: 0 }}>
          Detecta automáticamente zonas de consolidación y crea Volume Profiles
        </p>
      </div>

      {/* Configuración */}
      {isEnabled && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <h4>⚙️ Parámetros de Detección (ATR-Based)</h4>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Longitud Mínima del Rango (velas):
              </label>
              <input
                type="number"
                value={config.minRangeLength}
                onChange={(e) => handleConfigChange('minRangeLength', parseInt(e.target.value))}
                min="10"
                max="50"
                style={{ width: '100%', padding: '6px' }}
              />
              <small style={{ fontSize: '11px', color: '#666' }}>
                Número mínimo de velas consecutivas dentro del rango ATR. Default: 20
              </small>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Multiplicador ATR:
              </label>
              <input
                type="number"
                value={config.atrMultiplier}
                onChange={(e) => handleConfigChange('atrMultiplier', parseFloat(e.target.value))}
                min="0.5"
                max="3"
                step="0.1"
                style={{ width: '100%', padding: '6px' }}
              />
              <small style={{ fontSize: '11px', color: '#666' }}>
                Multiplica el ATR para definir el ancho del rango. Mayor = rangos más amplios. Default: 1.0
              </small>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Período ATR:
              </label>
              <input
                type="number"
                value={config.atrLength}
                onChange={(e) => handleConfigChange('atrLength', parseInt(e.target.value))}
                min="50"
                max="500"
                step="10"
                style={{ width: '100%', padding: '6px' }}
              />
              <small style={{ fontSize: '11px', color: '#666' }}>
                Período para calcular el ATR. Mayor = más suave, menor = más reactivo. Default: 200
              </small>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Máximo rangos activos:
              </label>
              <input
                type="number"
                value={config.maxActiveRanges}
                onChange={(e) => handleConfigChange('maxActiveRanges', parseInt(e.target.value))}
                min="1"
                max="50"
                style={{ width: '100%', padding: '6px' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                🎯 Máximo velas fuera antes de finalizar rango:
              </label>
              <input
                type="number"
                value={config.maxBreakoutCandles}
                onChange={(e) => handleConfigChange('maxBreakoutCandles', parseInt(e.target.value))}
                min="1"
                max="20"
                style={{ width: '100%', padding: '6px' }}
              />
              <small style={{ fontSize: '11px', color: '#666' }}>
                Permite que el precio salga temporalmente y vuelva a entrar al rango. Default: 5
              </small>
            </div>

            <div style={{ marginBottom: '12px', padding: '12px', background: '#fff3e0', borderRadius: '4px', border: '1px solid #ffb74d' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.createTrendProfiles}
                  onChange={(e) => handleConfigChange('createTrendProfiles', e.target.checked)}
                  style={{ marginRight: '8px', width: '16px', height: '16px' }}
                />
                <strong>📊 Crear Volume Profile entre rangos (tendencias)</strong>
              </label>
              <small style={{ fontSize: '11px', color: '#666', marginTop: '6px', display: 'block', marginLeft: '24px' }}>
                Genera VP fixed range en los espacios entre rangos detectados para analizar movimientos de tendencia. Default: Desactivado
              </small>
            </div>

            <div style={{ marginBottom: '12px', padding: '12px', background: '#e3f2fd', borderRadius: '4px', border: '1px solid #64b5f6' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.showOtherTimeframes}
                  onChange={(e) => handleConfigChange('showOtherTimeframes', e.target.checked)}
                  style={{ marginRight: '8px', width: '16px', height: '16px' }}
                />
                <strong>🕐 Mostrar rangos de otros timeframes</strong>
              </label>
              <small style={{ fontSize: '11px', color: '#666', marginTop: '6px', display: 'block', marginLeft: '24px' }}>
                Permite visualizar rangos detectados en timeframes diferentes al actual. Default: Desactivado
              </small>
            </div>
          </div>

          {/* Filtro de fechas */}
          <div style={{ marginBottom: '20px', padding: '15px', background: '#f9f9f9', borderRadius: '4px' }}>
            <h4 style={{ marginTop: 0 }}>📅 Filtro de Rango de Fechas</h4>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Fecha inicio:
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ width: '100%', padding: '6px' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Fecha fin:
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ width: '100%', padding: '6px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleDateFilterApply}
                disabled={!startDate || !endDate}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  opacity: (!startDate || !endDate) ? 0.5 : 1
                }}
              >
                Aplicar Filtro
              </button>
              <button
                onClick={handleDateFilterClear}
                disabled={!dateFilterEnabled}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  opacity: !dateFilterEnabled ? 0.5 : 1
                }}
              >
                Limpiar Filtro
              </button>
            </div>
          </div>

          {/* Rangos detectados */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0 }}>✨ Rangos Auto-Detectados</h4>
              {autoRanges.length > 0 && (
                <button
                  onClick={handleClearAutoRanges}
                  style={{
                    padding: '4px 8px',
                    background: '#ff9800',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Limpiar Todos
                </button>
              )}
            </div>

            {autoRanges.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>
                No hay rangos detectados aún
              </p>
            ) : (
              <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                {autoRanges.map((range, i) => (
                  <div key={range.rangeId} style={{
                    padding: '10px',
                    background: i % 2 === 0 ? '#f9f9f9' : '#fff',
                    borderRadius: '4px',
                    marginBottom: '6px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px'
                  }}>
                    {/* 🎯 NUEVO: Checkbox para mostrar/ocultar */}
                    <input
                      type="checkbox"
                      checked={range.enabled !== false}
                      onChange={() => handleToggleRange(range.rangeId, range.enabled !== false)}
                      style={{
                        marginTop: '2px',
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                        flexShrink: 0
                      }}
                      title={range.enabled !== false ? "Ocultar rango" : "Mostrar rango"}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#9C27B0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {/* Etiqueta alfabética */}
                        {range.rangeLabel && (
                          <span style={{
                            background: '#9C27B0',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 'bold'
                          }}>
                            {range.rangeLabel}
                          </span>
                        )}
                        <span>Rango #{i + 1}</span>
                        {range.detectionScore && <span style={{ fontSize: '10px', color: '#666' }}>Score: {range.detectionScore.toFixed(1)}</span>}
                        {/* 🎯 NUEVO: Mostrar timeframe */}
                        {range.interval && (
                          <span style={{
                            background: '#e0e0e0',
                            color: '#555',
                            padding: '1px 4px',
                            borderRadius: '2px',
                            fontSize: '10px'
                          }}>
                            {range.interval}m
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
                        {new Date(range.startTimestamp).toLocaleString('es-CO')} → {new Date(range.endTimestamp).toLocaleString('es-CO')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Botones de acción */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '10px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
};

export default RangeDetectionSettings;
