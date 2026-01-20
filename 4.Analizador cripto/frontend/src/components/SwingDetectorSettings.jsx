// src/components/SwingDetectorSettings.jsx
import React, { useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from '../config.js';

/**
 * SwingDetectorSettings - Configuration panel for the Swing Detector
 *
 * Controls backend service configuration:
 * - Enable/disable
 * - Direction filter (LONG/SHORT/BOTH)
 * - Volume z-score threshold and lookback
 * - Swing bars parameter
 * - Price zones management (manual + from chart rectangles)
 * - Arrow style settings
 */
const SwingDetectorSettings = ({
  config,
  onConfigChange,
  currentSymbol,
  watchlistDays,      // Days selected in Watchlist (synced automatically)
  watchlistInterval,  // Interval selected in Watchlist
  onBackendConfigSaved // Callback when backend config is saved (to refresh indicators)
}) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [backendStatus, setBackendStatus] = useState(null);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [newZone, setNewZone] = useState({ min: '', max: '', direction: 'BOTH' });
  const [loading, setLoading] = useState(false);

  // 🎯 NEW: State for chart drawings (rectangles)
  const [chartRectangles, setChartRectangles] = useState([]);
  const [showRectangleSelector, setShowRectangleSelector] = useState(false);
  const [rectTimeBound, setRectTimeBound] = useState({}); // Track time-bound option per rectangle

  // 🚀 PERF: Batch mode - accumulate changes locally, send on button click
  const [pendingChanges, setPendingChanges] = useState({});
  const [localSymbolConfig, setLocalSymbolConfig] = useState(null); // Local copy for immediate UI updates
  const [applyToAllSymbols, setApplyToAllSymbols] = useState(false); // 🌐 Apply changes to all symbols

  // Fetch backend status and chart drawings on mount
  useEffect(() => {
    fetchBackendStatus();
    fetchChartDrawings();
  }, [currentSymbol]);

  // Initialize local config from backend status
  useEffect(() => {
    if (backendStatus) {
      setLocalSymbolConfig(backendStatus.symbolConfig || {});
      setPendingChanges({}); // Clear pending when we get fresh data
    }
  }, [backendStatus]);

  // 🎯 NEW: Fetch chart drawings for current symbol
  const fetchChartDrawings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${currentSymbol}`);
      if (response.ok) {
        const data = await response.json();
        if (data.shapes && Array.isArray(data.shapes)) {
          // Filter only rectangles
          const rectangles = data.shapes.filter(shape => shape.type === 'rectangle');
          setChartRectangles(rectangles);
          console.log(`[SwingDetector] Found ${rectangles.length} rectangles for ${currentSymbol}`);
        }
      }
    } catch (error) {
      console.error('Failed to fetch chart drawings:', error);
      setChartRectangles([]);
    }
  };

  // Update local config when props change
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  // 🔄 AUTO-SYNC: When watchlistDays changes, update backend automatically
  useEffect(() => {
    const syncDaysToBackend = async () => {
      if (watchlistDays && backendStatus) {
        const currentBackendDays = backendStatus.symbolConfig?.days || backendStatus.days;
        if (currentBackendDays !== watchlistDays) {
          console.log(`[SwingDetector] Auto-syncing days: ${currentBackendDays} → ${watchlistDays}`);
          try {
            // Send directly to backend (bypass batch mode)
            const response = await fetch(`${API_BASE_URL}/api/swing/config/${currentSymbol}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days: watchlistDays })
            });
            if (response.ok) {
              console.log(`[SwingDetector] Days synced to ${watchlistDays}`);
              // Refresh status to reflect new value
              fetchBackendStatus();
            }
          } catch (error) {
            console.error('[SwingDetector] Failed to sync days:', error);
          }
        }
      }
    };
    syncDaysToBackend();
  }, [watchlistDays, currentSymbol]);

  const fetchBackendStatus = async () => {
    try {
      // Fetch status with current symbol to get merged config
      const response = await fetch(`${API_BASE_URL}/api/swing/status?symbol=${currentSymbol}`);
      if (response.ok) {
        const data = await response.json();
        setBackendStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch swing status:', error);
    }
  };

  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  // 🚀 PERF: Batch mode - accumulate changes locally, NO automatic sending
  // Changes are only sent when user clicks "Save Changes" button
  const handleBackendConfigUpdate = useCallback((updates) => {
    // 1. Update local state immediately for responsive UI
    setLocalSymbolConfig(prev => {
      const current = prev || {};
      const newConfig = { ...current };

      for (const [key, value] of Object.entries(updates)) {
        if (key === 'volumeFilter') {
          newConfig.volumeFilter = {
            ...(current.volumeFilter || backendStatus?.volumeFilter || {}),
            ...value
          };
        } else if (key === 'vwapFilter') {
          newConfig.vwapFilter = {
            ...(current.vwapFilter || backendStatus?.vwapFilter || {}),
            ...value
          };
        } else {
          newConfig[key] = value;
        }
      }

      return newConfig;
    });

    // 2. Accumulate pending changes (merge with existing)
    setPendingChanges(prev => {
      const merged = { ...prev, ...updates };

      // Handle nested volumeFilter merging
      if (updates.volumeFilter && prev.volumeFilter) {
        merged.volumeFilter = {
          ...prev.volumeFilter,
          ...updates.volumeFilter
        };
      }

      // Handle nested vwapFilter merging
      if (updates.vwapFilter && prev.vwapFilter) {
        merged.vwapFilter = {
          ...prev.vwapFilter,
          ...updates.vwapFilter
        };
      }

      return merged;
    });
  }, [backendStatus]);

  // 🚀 Send all pending changes to backend
  const handleSaveChanges = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      return; // Nothing to save
    }

    setLoading(true);
    try {
      // Separate global config (cooldownMinutes) from symbol-specific config
      // NOTE: 'days' is now per-symbol to allow different history lengths per symbol
      const globalFields = ['cooldownMinutes'];
      const globalChanges = {};
      const symbolChanges = {};

      for (const [key, value] of Object.entries(pendingChanges)) {
        if (globalFields.includes(key)) {
          globalChanges[key] = value;
        } else {
          symbolChanges[key] = value;
        }
      }

      let success = true;

      // 1. Send global changes if any
      if (Object.keys(globalChanges).length > 0) {
        const globalResponse = await fetch(`${API_BASE_URL}/api/swing/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(globalChanges)
        });

        if (globalResponse.ok) {
          console.log(`[SwingDetector] Global config saved:`, Object.keys(globalChanges));
        } else {
          console.error('[SwingDetector] Global config update failed');
          success = false;
        }
      }

      // 2. Send symbol-specific changes
      if (Object.keys(symbolChanges).length > 0) {
        // 🌐 NEW: Apply to all symbols if checkbox is checked
        if (applyToAllSymbols) {
          const applyAllResponse = await fetch(`${API_BASE_URL}/api/swing/config/apply-to-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(symbolChanges)
          });

          if (applyAllResponse.ok) {
            const result = await applyAllResponse.json();
            console.log(`[SwingDetector] Config applied to ALL symbols:`, Object.keys(symbolChanges), result.updated_symbols);
          } else {
            console.error('[SwingDetector] Apply to all symbols failed');
            success = false;
          }
        } else {
          // Original: apply only to current symbol
          const symbolResponse = await fetch(`${API_BASE_URL}/api/swing/config/${currentSymbol}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(symbolChanges)
          });

          if (symbolResponse.ok) {
            const result = await symbolResponse.json();
            console.log(`[SwingDetector] Symbol config saved for ${currentSymbol}:`, Object.keys(symbolChanges));

            // Update backend status with response
            if (result.symbolConfig) {
              setBackendStatus(prev => ({
                ...prev,
                symbolConfig: result.symbolConfig
              }));
            }
          } else {
            console.error('[SwingDetector] Symbol config update failed');
            success = false;
          }
        }
      }

      if (success) {
        // Refresh full status to get updated values
        await fetchBackendStatus();
        // Clear pending changes and reset checkbox
        setPendingChanges({});
        setApplyToAllSymbols(false);
        // 🔄 Notify parent to refresh indicators (so chart updates immediately)
        if (onBackendConfigSaved) {
          onBackendConfigSaved();
        }
      } else {
        alert('Error al guardar algunos cambios');
      }
    } catch (error) {
      console.error('[SwingDetector] Backend config error:', error);
      alert('Error de conexión al guardar');
    } finally {
      setLoading(false);
    }
  };

  // Discard pending changes and reload from backend
  const handleDiscardChanges = () => {
    setPendingChanges({});
    setLocalSymbolConfig(backendStatus?.symbolConfig || {});
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = Object.keys(pendingChanges).length > 0;

  const handleAddZone = async () => {
    if (!newZone.min || !newZone.max) {
      alert('Please enter both min and max prices');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/swing/add-zone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `zone_${Date.now()}`,
          symbol: currentSymbol, // Zone is specific to this symbol
          min: parseFloat(newZone.min),
          max: parseFloat(newZone.max),
          direction: newZone.direction,
          enabled: true
        })
      });

      if (response.ok) {
        setNewZone({ min: '', max: '', direction: 'BOTH' });
        setShowZoneForm(false);
        fetchBackendStatus();
      }
    } catch (error) {
      console.error('[SwingDetector] Add zone error:', error);
    }
  };

  const handleDeleteZone = async (zoneId) => {
    if (!window.confirm('Delete this zone?')) return;

    try {
      await fetch(`${API_BASE_URL}/api/swing/zone/${zoneId}`, {
        method: 'DELETE'
      });
      fetchBackendStatus();
    } catch (error) {
      console.error('[SwingDetector] Delete zone error:', error);
    }
  };

  // 🎯 NEW: Add zone from chart rectangle
  const handleAddZoneFromRectangle = async (rect, direction = 'BOTH', timeBound = false) => {
    try {
      // Get min and max prices from rectangle
      const minPrice = Math.min(rect.price1, rect.price2, rect.priceHigh || 0, rect.priceLow || 0);
      const maxPrice = Math.max(rect.price1, rect.price2, rect.priceHigh || 0, rect.priceLow || 0);

      // Ensure we have valid prices
      const actualMin = minPrice > 0 ? minPrice : Math.min(rect.price1, rect.price2);
      const actualMax = maxPrice > 0 ? maxPrice : Math.max(rect.price1, rect.price2);

      // Get time bounds from rectangle if time-bound option is enabled
      const timeStart = timeBound ? Math.min(rect.time1, rect.time2, rect.timeStart || Infinity, rect.timeEnd || Infinity) : null;
      const timeEnd = timeBound ? Math.max(rect.time1, rect.time2, rect.timeStart || 0, rect.timeEnd || 0) : null;

      // Ensure valid timestamps
      const actualTimeStart = timeBound && timeStart && timeStart !== Infinity ? timeStart : null;
      const actualTimeEnd = timeBound && timeEnd && timeEnd !== 0 ? timeEnd : null;

      const response = await fetch(`${API_BASE_URL}/api/swing/add-zone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `zone_rect_${rect.id || Date.now()}`,
          symbol: currentSymbol, // Zone is specific to this symbol
          min: actualMin,
          max: actualMax,
          direction: direction,
          enabled: true,
          sourceRectId: rect.id, // Track which rectangle this came from
          label: rect.label || 'Zone',
          // Time bounds (null if not time-bound)
          timeStart: actualTimeStart,
          timeEnd: actualTimeEnd,
          timeBound: timeBound
        })
      });

      if (response.ok) {
        setShowRectangleSelector(false);
        fetchBackendStatus();
        const timeInfo = timeBound ? ` (time-bound: ${new Date(actualTimeStart).toLocaleString()} - ${new Date(actualTimeEnd).toLocaleString()})` : ' (no time limit)';
        console.log(`[SwingDetector] Added zone from rectangle: $${actualMin.toFixed(2)} - $${actualMax.toFixed(2)}${timeInfo}`);
      }
    } catch (error) {
      console.error('[SwingDetector] Add zone from rectangle error:', error);
    }
  };

  const handleClearCooldowns = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/swing/clear-cooldowns`, {
        method: 'POST'
      });
      fetchBackendStatus();
      alert('Cooldowns cleared');
    } catch (error) {
      console.error('[SwingDetector] Clear cooldowns error:', error);
    }
  };

  // Get symbol-specific config - use LOCAL state for immediate UI response
  const symbolConfig = localSymbolConfig || backendStatus?.symbolConfig || {};
  const volumeFilter = symbolConfig.volumeFilter || backendStatus?.volumeFilter || { enabled: true, minZScore: 1.5, lookbackBars: 20 };
  const vwapFilter = symbolConfig.vwapFilter || backendStatus?.vwapFilter || { enabled: false, deviations: [1, 2, 3], marginPercent: 20, skipVolumeInRectangle: false };
  const currentDirection = symbolConfig.direction || backendStatus?.direction || 'BOTH';
  const currentSwingBars = symbolConfig.swingBars || backendStatus?.swingBars || 5;
  const currentDays = symbolConfig.days || backendStatus?.days || 1;
  const currentCooldown = symbolConfig.cooldownMinutes || backendStatus?.cooldownMinutes || 30;
  // Filter zones by current symbol (zones without symbol field are shown for backwards compatibility)
  const allPriceZones = backendStatus?.priceZones || [];
  const priceZones = allPriceZones.filter(zone => !zone.symbol || zone.symbol === currentSymbol);

  return (
    <div className="swing-detector-settings" style={{ padding: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#00BCD4' }}>
          Swing Detector - {currentSymbol}
        </h4>

        {/* 🚀 Unsaved Changes Banner */}
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
              ⚠️ Cambios sin guardar
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
              {/* 🌐 Checkbox para aplicar a todas las monedas */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                fontSize: '11px',
                color: applyToAllSymbols ? '#1976D2' : '#666'
              }}>
                <input
                  type="checkbox"
                  checked={applyToAllSymbols}
                  onChange={(e) => setApplyToAllSymbols(e.target.checked)}
                  style={{ marginRight: '6px' }}
                />
                🌐 Aplicar a TODAS las monedas
              </label>
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
                    background: loading ? '#FFB74D' : (applyToAllSymbols ? '#1976D2' : '#FF9800'),
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'default' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  {loading ? 'Guardando...' : (applyToAllSymbols ? '🌐 Guardar para TODAS' : 'Guardar Cambios')}
                </button>
              </div>
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
                Signals: {backendStatus.stats?.signals_detected || 0} |
                Alerts: {backendStatus.stats?.alerts_sent || 0} |
                Blocked: {backendStatus.stats?.alerts_blocked_cooldown || 0}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Enable/Disable Display */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontWeight: 'bold'
        }}>
          <input
            type="checkbox"
            checked={localConfig.enabled}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Enable Swing Detector Display
        </label>
      </div>

      {/* Detection Parameters */}
      <div style={{
        background: '#e0f7fa',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #00BCD4'
      }}>
        <h5 style={{ margin: '0 0 12px 0', color: '#00838F' }}>Detection Parameters (Backend)</h5>

        {/* Days of Historical Data - READ ONLY, synced from Watchlist */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Historical Days: {watchlistDays || currentDays}
          </label>
          <div style={{
            padding: '8px 12px',
            background: '#b2ebf2',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#006064'
          }}>
            📊 Synced from Watchlist ({watchlistInterval || backendStatus?.interval}m timeframe)
          </div>
          <div style={{ fontSize: '10px', color: '#00838F', marginTop: '4px' }}>
            {(() => {
              const interval = watchlistInterval || backendStatus?.interval || '1';
              const days = watchlistDays || currentDays;
              const intervalMinutes = {
                '1': 1, '3': 3, '5': 5, '15': 15, '30': 30,
                '60': 60, '120': 120, '240': 240, '360': 360, '720': 720,
                'D': 1440, 'W': 10080
              };
              const minPerCandle = intervalMinutes[interval] || 1;
              const candles = Math.floor((days * 24 * 60) / minPerCandle);
              return `≈ ${candles.toLocaleString()} candles for ${interval}m interval`;
            })()}
          </div>
        </div>

        {/* Direction Filter */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Direction Filter:
          </label>
          <select
            value={currentDirection}
            onChange={(e) => handleBackendConfigUpdate({ direction: e.target.value })}
            disabled={loading}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid #00BCD4'
            }}
          >
            <option value="BOTH">BOTH - Detect highs and lows</option>
            <option value="LONG">LONG - Only swing lows (buy signals)</option>
            <option value="SHORT">SHORT - Only swing highs (sell signals)</option>
          </select>
        </div>

        {/* Swing Bars */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Swing Bars (N bars each side): {currentSwingBars}
          </label>
          <input
            type="range"
            min="2"
            max="10"
            value={currentSwingBars}
            onChange={(e) => handleBackendConfigUpdate({ swingBars: parseInt(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>2 (sensitive)</span>
            <span>10 (strict)</span>
          </div>
        </div>

        {/* Cooldown */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Alert Cooldown: {currentCooldown} min
          </label>
          <input
            type="range"
            min="1"
            max="120"
            value={currentCooldown}
            onChange={(e) => handleBackendConfigUpdate({ cooldownMinutes: parseInt(e.target.value) })}
            disabled={loading}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
            <span>1 min</span>
            <span>120 min</span>
          </div>
        </div>
      </div>

      {/* Volume Filter */}
      <div style={{
        background: '#f3e5f5',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #9C27B0'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h5 style={{ margin: 0, color: '#7B1FA2' }}>Volume Filter</h5>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={volumeFilter.enabled}
              onChange={(e) => handleBackendConfigUpdate({
                volumeFilter: { ...volumeFilter, enabled: e.target.checked }
              })}
              disabled={loading}
              style={{ marginRight: '6px' }}
            />
            Enabled
          </label>
        </div>

        {volumeFilter.enabled && (
          <>
            {/* Min Z-Score */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                Min Z-Score: {volumeFilter.minZScore?.toFixed(1) || '1.5'}
              </label>
              <input
                type="range"
                min="0"
                max="4"
                step="0.1"
                value={volumeFilter.minZScore || 1.5}
                onChange={(e) => handleBackendConfigUpdate({
                  volumeFilter: { ...volumeFilter, minZScore: parseFloat(e.target.value) }
                })}
                disabled={loading}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
                <span>0 (no filter)</span>
                <span>2.0 (moderate)</span>
                <span>4.0 (strict)</span>
              </div>
            </div>

            {/* Lookback Bars */}
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                Lookback Bars: {volumeFilter.lookbackBars || 20}
              </label>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={volumeFilter.lookbackBars || 20}
                onChange={(e) => handleBackendConfigUpdate({
                  volumeFilter: { ...volumeFilter, lookbackBars: parseInt(e.target.value) }
                })}
                disabled={loading}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
                <span>10</span>
                <span>100</span>
              </div>
            </div>
          </>
        )}

        {!volumeFilter.enabled && (
          <div style={{ fontSize: '11px', color: '#9C27B0', fontStyle: 'italic' }}>
            Volume filter disabled - all swings will be detected regardless of volume
          </div>
        )}
      </div>

      {/* VWAP Filter */}
      <div style={{
        background: '#e3f2fd',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #2196F3'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h5 style={{ margin: 0, color: '#1565C0' }}>VWAP Filter</h5>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={vwapFilter.enabled}
              onChange={(e) => handleBackendConfigUpdate({
                vwapFilter: { ...vwapFilter, enabled: e.target.checked }
              })}
              style={{ marginRight: '6px' }}
            />
            Enabled
          </label>
        </div>

        {vwapFilter.enabled && (
          <>
            <div style={{ fontSize: '11px', color: '#1565C0', marginBottom: '12px', padding: '8px', background: '#bbdefb', borderRadius: '4px' }}>
              <strong>Dentro de rectángulos:</strong><br/>
              • Precio cerca de bandas inferiores (-σ) → solo señales LONG<br/>
              • Precio cerca de bandas superiores (+σ) → solo señales SHORT
            </div>

            {/* Deviations Selection */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                Desviaciones a considerar:
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {[1, 2, 3].map(dev => (
                  <label key={dev} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
                    <input
                      type="checkbox"
                      checked={(vwapFilter.deviations || []).includes(dev)}
                      onChange={(e) => {
                        const currentDevs = vwapFilter.deviations || [1, 2, 3];
                        const newDevs = e.target.checked
                          ? [...currentDevs, dev].sort()
                          : currentDevs.filter(d => d !== dev);
                        handleBackendConfigUpdate({
                          vwapFilter: { ...vwapFilter, deviations: newDevs }
                        });
                      }}
                      style={{ marginRight: '4px' }}
                    />
                    {dev}σ
                  </label>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                Bandas que activan el filtro (±1σ, ±2σ, ±3σ)
              </div>
            </div>

            {/* Margin Percent */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                Margen: {vwapFilter.marginPercent || 20}%
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={vwapFilter.marginPercent || 20}
                onChange={(e) => handleBackendConfigUpdate({
                  vwapFilter: { ...vwapFilter, marginPercent: parseInt(e.target.value) }
                })}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666' }}>
                <span>5% (estricto)</span>
                <span>50% (amplio)</span>
              </div>
              <div style={{ fontSize: '10px', color: '#1565C0', marginTop: '4px' }}>
                % del ancho de la banda como zona de tolerancia
              </div>
            </div>

            {/* Skip Volume in Rectangle */}
            <div style={{
              padding: '8px',
              background: '#e1f5fe',
              borderRadius: '4px',
              border: '1px solid #81d4fa'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={vwapFilter.skipVolumeInRectangle || false}
                  onChange={(e) => handleBackendConfigUpdate({
                    vwapFilter: { ...vwapFilter, skipVolumeInRectangle: e.target.checked }
                  })}
                  style={{ marginRight: '8px' }}
                />
                <span>
                  <strong>Ignorar filtro de volumen</strong> dentro de rectángulos
                </span>
              </label>
              <div style={{ fontSize: '10px', color: '#0277bd', marginTop: '4px', marginLeft: '24px' }}>
                Si está activo, las señales dentro de rectángulos no requieren validación de volumen
              </div>
            </div>
          </>
        )}

        {!vwapFilter.enabled && (
          <div style={{ fontSize: '11px', color: '#1565C0', fontStyle: 'italic' }}>
            Filtro VWAP desactivado - señales se envían sin validar posición respecto al VWAP
          </div>
        )}
      </div>

      {/* Price Zones */}
      <div style={{
        background: '#fff3e0',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '2px solid #FF9800'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h5 style={{ margin: 0, color: '#F57C00' }}>Price Zones ({priceZones.length})</h5>
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Button to select from chart rectangles */}
            <button
              onClick={() => {
                fetchChartDrawings(); // Refresh rectangles
                setShowRectangleSelector(!showRectangleSelector);
                setShowZoneForm(false);
              }}
              style={{
                padding: '4px 12px',
                background: chartRectangles.length > 0 ? '#3B82F6' : '#9CA3AF',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: chartRectangles.length > 0 ? 'pointer' : 'default',
                fontSize: '12px',
                fontWeight: 'bold',
                opacity: chartRectangles.length > 0 ? 1 : 0.7
              }}
              title={chartRectangles.length > 0
                ? `Select from ${chartRectangles.length} rectangle(s) drawn on chart`
                : 'No rectangles drawn on chart. Draw a rectangle first!'}
            >
              📐 From Chart ({chartRectangles.length})
            </button>
            <button
              onClick={() => {
                setShowZoneForm(!showZoneForm);
                setShowRectangleSelector(false);
              }}
              style={{
                padding: '4px 12px',
                background: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold'
              }}
            >
              + Manual
            </button>
          </div>
        </div>

        {/* Add Zone Form */}
        {showZoneForm && (
          <div style={{
            background: 'white',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="number"
                placeholder="Min Price"
                value={newZone.min}
                onChange={(e) => setNewZone({ ...newZone, min: e.target.value })}
                style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <input
                type="number"
                placeholder="Max Price"
                value={newZone.max}
                onChange={(e) => setNewZone({ ...newZone, max: e.target.value })}
                style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={newZone.direction}
                onChange={(e) => setNewZone({ ...newZone, direction: e.target.value })}
                style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ddd' }}
              >
                <option value="BOTH">BOTH</option>
                <option value="LONG">LONG only</option>
                <option value="SHORT">SHORT only</option>
              </select>
              <button
                onClick={handleAddZone}
                style={{
                  padding: '8px 16px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* 🎯 NEW: Rectangle Selector from Chart Drawings */}
        {showRectangleSelector && (
          <div style={{
            background: '#EFF6FF',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '12px',
            border: '1px solid #3B82F6'
          }}>
            <div style={{ marginBottom: '8px', fontSize: '12px', color: '#1E40AF', fontWeight: 'bold' }}>
              📐 Select Rectangle from Chart:
            </div>
            {chartRectangles.length > 0 ? (
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {chartRectangles.map((rect, idx) => {
                  const minPrice = Math.min(rect.price1 || 0, rect.price2 || 0, rect.priceHigh || 0, rect.priceLow || 0);
                  const maxPrice = Math.max(rect.price1 || 0, rect.price2 || 0, rect.priceHigh || 0, rect.priceLow || 0);
                  const actualMin = minPrice > 0 ? minPrice : Math.min(rect.price1, rect.price2);
                  const actualMax = maxPrice > 0 ? maxPrice : Math.max(rect.price1, rect.price2);

                  // Check if this rectangle is already added as a zone
                  const isAlreadyAdded = priceZones.some(zone =>
                    zone.sourceRectId === rect.id ||
                    (Math.abs(zone.min - actualMin) < 1 && Math.abs(zone.max - actualMax) < 1)
                  );

                  return (
                    <div
                      key={rect.id || idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px',
                        background: isAlreadyAdded ? '#F3F4F6' : 'white',
                        borderRadius: '4px',
                        marginBottom: '6px',
                        border: `1px solid ${isAlreadyAdded ? '#D1D5DB' : '#3B82F6'}`,
                        opacity: isAlreadyAdded ? 0.7 : 1
                      }}
                    >
                      <div style={{ fontSize: '12px' }}>
                        <div style={{ fontWeight: 'bold', color: '#1E40AF' }}>
                          {rect.label || 'Zone'}: ${actualMin?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} - ${actualMax?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </div>
                        <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                          ID: {rect.id?.substring(0, 20) || 'unknown'}...
                        </div>
                        {isAlreadyAdded && (
                          <div style={{ fontSize: '10px', color: '#059669', marginTop: '2px' }}>
                            ✓ Already added as zone
                          </div>
                        )}
                      </div>
                      {!isAlreadyAdded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                          {/* Time-bound checkbox */}
                          <label style={{
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                            fontSize: '10px',
                            color: '#4B5563',
                            background: rectTimeBound[rect.id] ? '#DBEAFE' : '#F3F4F6',
                            padding: '3px 6px',
                            borderRadius: '3px',
                            border: rectTimeBound[rect.id] ? '1px solid #3B82F6' : '1px solid #D1D5DB'
                          }}>
                            <input
                              type="checkbox"
                              checked={rectTimeBound[rect.id] || false}
                              onChange={(e) => setRectTimeBound(prev => ({
                                ...prev,
                                [rect.id]: e.target.checked
                              }))}
                              style={{ marginRight: '4px', width: '12px', height: '12px' }}
                            />
                            ⏱️ Time-bound
                          </label>
                          {/* Direction buttons */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => handleAddZoneFromRectangle(rect, 'LONG', rectTimeBound[rect.id] || false)}
                              style={{
                                padding: '4px 8px',
                                background: '#10B981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}
                              title="Add as LONG zone (buy signals only)"
                            >
                              LONG
                            </button>
                            <button
                              onClick={() => handleAddZoneFromRectangle(rect, 'BOTH', rectTimeBound[rect.id] || false)}
                              style={{
                                padding: '4px 8px',
                                background: '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}
                              title="Add as BOTH zone (all signals)"
                            >
                              BOTH
                            </button>
                            <button
                              onClick={() => handleAddZoneFromRectangle(rect, 'SHORT', rectTimeBound[rect.id] || false)}
                              style={{
                                padding: '4px 8px',
                                background: '#EF4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}
                              title="Add as SHORT zone (sell signals only)"
                            >
                              SHORT
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#6B7280', fontStyle: 'italic', textAlign: 'center', padding: '12px' }}>
                No rectangles found on chart.<br/>
                <span style={{ fontSize: '11px' }}>
                  Draw a rectangle on the chart to define a price zone, then click "📐 From Chart" to add it here.
                </span>
              </div>
            )}
            <button
              onClick={() => fetchChartDrawings()}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                background: '#E5E7EB',
                color: '#374151',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                width: '100%'
              }}
            >
              🔄 Refresh Rectangles
            </button>
          </div>
        )}

        {/* Active Zones List */}
        {priceZones.length > 0 ? (
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {priceZones.map((zone, idx) => {
              // Check if time-bound zone has expired
              const isTimeBound = zone.timeBound && zone.timeStart && zone.timeEnd;
              const now = Date.now();
              const isExpired = isTimeBound && now > zone.timeEnd;
              const isActive = !isTimeBound || (now >= zone.timeStart && now <= zone.timeEnd);

              return (
                <div
                  key={zone.id || idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    padding: '8px',
                    background: zone.enabled !== false ? (isExpired ? '#FEE2E2' : 'white') : '#f5f5f5',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    border: `1px solid ${isExpired ? '#EF4444' : zone.direction === 'LONG' ? '#4CAF50' : zone.direction === 'SHORT' ? '#f44336' : '#FF9800'}`,
                    opacity: isExpired ? 0.7 : 1
                  }}
                >
                  <div style={{ fontSize: '12px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                      <span style={{ fontWeight: 'bold' }}>
                        ${zone.min?.toLocaleString()} - ${zone.max?.toLocaleString()}
                      </span>
                      <span style={{
                        padding: '2px 6px',
                        background: zone.direction === 'LONG' ? '#e8f5e9' : zone.direction === 'SHORT' ? '#ffebee' : '#fff3e0',
                        color: zone.direction === 'LONG' ? '#4CAF50' : zone.direction === 'SHORT' ? '#f44336' : '#FF9800',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}>
                        {zone.direction || 'BOTH'}
                      </span>
                      {isTimeBound && (
                        <span style={{
                          padding: '2px 6px',
                          background: isExpired ? '#FEE2E2' : isActive ? '#DBEAFE' : '#F3F4F6',
                          color: isExpired ? '#DC2626' : isActive ? '#1D4ED8' : '#6B7280',
                          borderRadius: '3px',
                          fontSize: '9px',
                          fontWeight: 'bold'
                        }}>
                          ⏱️ {isExpired ? 'EXPIRED' : isActive ? 'ACTIVE' : 'PENDING'}
                        </span>
                      )}
                    </div>
                    {isTimeBound && (
                      <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '4px' }}>
                        {new Date(zone.timeStart).toLocaleString()} → {new Date(zone.timeEnd).toLocaleString()}
                      </div>
                    )}
                    {zone.sourceRectId && (
                      <div style={{ fontSize: '9px', color: '#9CA3AF', marginTop: '2px' }}>
                        📐 From chart rectangle
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteZone(zone.id)}
                    style={{
                      padding: '4px 8px',
                      background: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '10px',
                      marginLeft: '8px'
                    }}
                  >
                    X
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
            No price zones defined. Signals will be generated at any price level.
          </div>
        )}
      </div>

      {/* Arrow Style (Frontend) */}
      <div style={{
        background: '#f5f5f5',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h5 style={{ margin: '0 0 12px 0' }}>Arrow Style (Display)</h5>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            Arrow Size: {localConfig.arrowSize || 10}px
          </label>
          <input
            type="range"
            min="5"
            max="20"
            value={localConfig.arrowSize || 10}
            onChange={(e) => handleConfigChange('arrowSize', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Long Color:</label>
            <input
              type="color"
              value={localConfig.longColor || '#00E676'}
              onChange={(e) => handleConfigChange('longColor', e.target.value)}
              style={{ width: '100%', height: '32px', cursor: 'pointer', border: 'none' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Short Color:</label>
            <input
              type="color"
              value={localConfig.shortColor || '#FF1744'}
              onChange={(e) => handleConfigChange('shortColor', e.target.value)}
              style={{ width: '100%', height: '32px', cursor: 'pointer', border: 'none' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={localConfig.showVolumeZScore || false}
              onChange={(e) => handleConfigChange('showVolumeZScore', e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            Show z-score labels
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={localConfig.showZones !== false}
              onChange={(e) => handleConfigChange('showZones', e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            Show zone backgrounds
          </label>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const response = await fetch(`${API_BASE_URL}/api/swing/reanalyze`, {
                method: 'POST'
              });
              if (response.ok) {
                fetchBackendStatus();
                alert('Historical data re-analyzed!');
              }
            } catch (error) {
              console.error('Re-analyze error:', error);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '10px',
            background: loading ? '#A5D6A7' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'default' : 'pointer',
            fontWeight: 'bold',
            fontSize: '12px'
          }}
        >
          Re-analyze History
        </button>
        <button
          onClick={handleClearCooldowns}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '10px',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '12px'
          }}
        >
          Clear Cooldowns
        </button>
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
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
};

export default SwingDetectorSettings;
