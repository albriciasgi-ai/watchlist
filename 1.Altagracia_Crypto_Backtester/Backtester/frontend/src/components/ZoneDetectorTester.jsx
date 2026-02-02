// ZoneDetectorTester.jsx
// UI para probar y visualizar el Zone Detector 2.0

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import './ZoneDetectorTester.css';

const ZoneDetectorTester = ({
  symbol,
  interval,
  playbackStartTime,  // 🎯 NUEVO: Timestamp de inicio de reproducción (para filtrar datos)
  onZonesDetected,  // Callback para enviar zonas al chart
  onZoneClick,      // 🎯 NUEVO: Callback para navegar a una zona (centrar chart)
  onClearZones,     // 🎯 NUEVO: Callback para limpiar zonas del chart
  onClose
}) => {
  // Estado del componente
  const [activeTab, setActiveTab] = useState('detect'); // 'detect', 'evaluate', 'optimize', 'compare'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Parámetros de detección
  const [method, setMethod] = useState('consolidation');  // 🎯 Método por defecto: consolidación
  const [days, setDays] = useState(365);
  const [params, setParams] = useState({
    max_price_range_pct: 5.0,  // Máximo rango de precio % para considerar zona válida
    pivot_tolerance_pct: 0.3,
    pivot_min_touches: 3,
    pivot_swing_bars: 5,
    atr_period: 14,
    atr_threshold: 0.7,
    vp_value_area_pct: 70,
    vp_price_bins: 50,
    pa_touch_tolerance_pct: 0.2,
    pa_min_touches: 3,
    // 🎯 NUEVO: Parámetros para método Consolidation
    consol_min_bars: 8,         // Mínimo de velas en consolidación
    consol_max_bars: 50,        // Máximo de velas
    consol_max_range_pct: 3.0,  // Máximo % de rango de precio
    consol_atr_ratio: 0.6,      // ATR local vs global (< 1 = baja volatilidad)
    consol_body_ratio: 0.5,     // Ratio cuerpo/rango de velas
    consol_max_outside_bars: 3  // Velas consecutivas fuera del rango antes de cerrar
  });

  // Resultados
  const [detectResult, setDetectResult] = useState(null);
  const [evaluateResult, setEvaluateResult] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [optimizeResult, setOptimizeResult] = useState(null);

  // Información de métodos
  const [methodsInfo, setMethodsInfo] = useState(null);

  // Cargar información de métodos al montar
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/zones/methods`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setMethodsInfo(data);
        }
      })
      .catch(err => console.error('Error loading methods:', err));
  }, []);

  // =========================================================================
  // DETECTAR ZONAS
  // =========================================================================
  const handleDetect = async () => {
    setLoading(true);
    setError(null);

    try {
      // 🎯 Construir el body con end_timestamp si está disponible
      const requestBody = {
        symbol,
        interval: interval.replace('m', '').replace('h', interval.includes('h') ? '0' : ''),
        days,
        method,
        params: getMethodParams()
      };

      // 🎯 Si hay fecha de inicio de playback, usarla como límite
      // Solo se usarán datos ANTERIORES a esta fecha
      if (playbackStartTime) {
        requestBody.end_timestamp = playbackStartTime;
        console.log(`[ZoneDetectorTester] 📅 Usando end_timestamp: ${playbackStartTime} (${new Date(playbackStartTime).toISOString()})`);
      } else {
        console.log(`[ZoneDetectorTester] ⚠️ No hay playbackStartTime, usando datos hasta fecha actual`);
      }

      const response = await fetch(`${API_BASE_URL}/api/zones/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (data.success) {
        setDetectResult(data);

        // 🔍 DEBUG: Verificar timestamps de las zonas
        if (data.zones && data.zones.length > 0) {
          console.log(`[ZoneDetectorTester] 📊 Zonas recibidas: ${data.zones.length}`);
          data.zones.slice(0, 3).forEach((zone, idx) => {
            console.log(`[ZoneDetectorTester] Zona #${idx + 1}:`, {
              id: zone.id,
              start_timestamp: zone.start_timestamp,
              end_timestamp: zone.end_timestamp,
              start_date: new Date(zone.start_timestamp).toISOString(),
              end_date: new Date(zone.end_timestamp).toISOString(),
              min_price: zone.min_price,
              max_price: zone.max_price
            });
          });
        }

        // Enviar zonas al chart para visualización (ordenadas por timestamp)
        if (onZonesDetected && data.zones) {
          const sortedZones = [...data.zones].sort((a, b) => a.start_timestamp - b.start_timestamp);
          onZonesDetected(sortedZones);
        } else if (onZonesDetected && data.zones_by_method) {
          // Si es "all", enviar todas las zonas ordenadas
          const allZones = Object.values(data.zones_by_method).flat();
          const sortedZones = allZones.sort((a, b) => a.start_timestamp - b.start_timestamp);
          onZonesDetected(sortedZones);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // EVALUAR ZONAS
  // =========================================================================
  const handleEvaluate = async () => {
    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        symbol,
        interval: interval.replace('m', '').replace('h', interval.includes('h') ? '0' : ''),
        days,
        method,
        detection_params: getMethodParams()
      };

      // 🎯 Si hay fecha de inicio de playback, usarla como límite
      if (playbackStartTime) {
        requestBody.end_timestamp = playbackStartTime;
      }

      const response = await fetch(`${API_BASE_URL}/api/zones/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (data.success) {
        setEvaluateResult(data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // COMPARAR MÉTODOS
  // =========================================================================
  const handleCompare = async () => {
    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        symbol,
        interval: interval.replace('m', '').replace('h', interval.includes('h') ? '0' : ''),
        days
      };

      // 🎯 Si hay fecha de inicio de playback, usarla como límite
      if (playbackStartTime) {
        requestBody.end_timestamp = playbackStartTime;
      }

      const response = await fetch(`${API_BASE_URL}/api/zones/compare-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (data.success) {
        setCompareResult(data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // OPTIMIZAR PARÁMETROS
  // =========================================================================
  const handleOptimize = async (walkForward = false) => {
    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        symbol,
        interval: interval.replace('m', '').replace('h', interval.includes('h') ? '0' : ''),
        days: Math.max(days, 365), // Mínimo 1 año para optimización
        method,
        walk_forward: walkForward
      };

      // 🎯 Si hay fecha de inicio de playback, usarla como límite
      if (playbackStartTime) {
        requestBody.end_timestamp = playbackStartTime;
      }

      const response = await fetch(`${API_BASE_URL}/api/zones/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (data.success) {
        setOptimizeResult(data);

        // Aplicar mejores parámetros encontrados
        if (data.best_params) {
          setParams(prev => ({ ...prev, ...data.best_params }));
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Obtener parámetros específicos del método actual
  const getMethodParams = () => {
    const methodParams = {
      // Siempre incluir el filtro de rango máximo
      max_price_range_pct: params.max_price_range_pct
    };
    if (method === 'pivot_cluster' || method === 'all') {
      methodParams.pivot_tolerance_pct = params.pivot_tolerance_pct;
      methodParams.pivot_min_touches = params.pivot_min_touches;
      methodParams.pivot_swing_bars = params.pivot_swing_bars;
    }
    if (method === 'atr_based' || method === 'all') {
      methodParams.atr_period = params.atr_period;
      methodParams.atr_threshold = params.atr_threshold;
    }
    if (method === 'volume_profile' || method === 'all') {
      methodParams.vp_value_area_pct = params.vp_value_area_pct;
      methodParams.vp_price_bins = params.vp_price_bins;
    }
    if (method === 'price_action' || method === 'all') {
      methodParams.pa_touch_tolerance_pct = params.pa_touch_tolerance_pct;
      methodParams.pa_min_touches = params.pa_min_touches;
    }
    if (method === 'consolidation' || method === 'all') {
      methodParams.consol_min_bars = params.consol_min_bars;
      methodParams.consol_max_bars = params.consol_max_bars;
      methodParams.consol_max_range_pct = params.consol_max_range_pct;
      methodParams.consol_atr_ratio = params.consol_atr_ratio;
      methodParams.consol_body_ratio = params.consol_body_ratio;
      methodParams.consol_max_outside_bars = params.consol_max_outside_bars;
    }
    return methodParams;
  };

  // Renderizar parámetros del método actual
  const renderMethodParams = () => {
    if (!methodsInfo) return null;

    const methodConfig = methodsInfo.parameters[method];
    if (!methodConfig) return null;

    return (
      <div className="zdt-params-grid">
        {Object.entries(methodConfig).map(([key, config]) => (
          <div key={key} className="zdt-param-item">
            <label title={config.description}>
              {key.replace(/_/g, ' ')}
              <span className="zdt-param-hint">({config.range[0]} - {config.range[1]})</span>
            </label>
            <input
              type="number"
              value={params[key] || config.default}
              onChange={(e) => setParams(prev => ({
                ...prev,
                [key]: parseFloat(e.target.value)
              }))}
              step={key.includes('pct') || key.includes('ratio') ? 0.1 : 1}
              min={config.range[0]}
              max={config.range[1]}
            />
          </div>
        ))}
      </div>
    );
  };

  // Renderizar resultados de detección
  const renderDetectResults = () => {
    if (!detectResult) return null;

    // 🎯 FIX: Ordenar zonas por timestamp (cronológico) en lugar de por score
    const rawZones = detectResult.zones || [];
    const zones = [...rawZones].sort((a, b) => a.start_timestamp - b.start_timestamp);
    const zonesByMethod = detectResult.zones_by_method || {};

    return (
      <div className="zdt-results">
        <div className="zdt-results-header">
          <h4>Resultados de Detección</h4>
          <span className="zdt-results-count">
            {detectResult.total_zones} zonas encontradas
          </span>
        </div>

        {zones.length > 0 && (
          <div className="zdt-zones-list">
            {zones.slice(0, 20).map((zone, idx) => (
              <div
                key={zone.id || idx}
                className={`zdt-zone-card ${onZoneClick ? 'clickable' : ''}`}
                onClick={() => handleZoneClick(zone)}
                title={onZoneClick ? 'Click para centrar en esta zona' : ''}
              >
                <div className="zdt-zone-header">
                  {/* 🎯 NUEVO: Número de zona */}
                  <span className="zdt-zone-number">#{idx + 1}</span>
                  <span className="zdt-zone-score">Score: {zone.score?.toFixed(1)}</span>
                  <span className="zdt-zone-method">{zone.method}</span>
                </div>
                <div className="zdt-zone-prices">
                  <span>${zone.min_price?.toFixed(2)} - ${zone.max_price?.toFixed(2)}</span>
                  <span className="zdt-zone-range">({zone.price_range_pct?.toFixed(2)}%)</span>
                </div>
                {/* 🎯 NUEVO: Fechas de inicio y fin */}
                <div className="zdt-zone-dates">
                  <span className="zdt-zone-date-icon">📅</span>
                  <span>{formatZoneDate(zone.start_timestamp)}</span>
                  <span className="zdt-zone-date-arrow">→</span>
                  <span>{formatZoneDate(zone.end_timestamp)}</span>
                </div>
                <div className="zdt-zone-stats">
                  <span>Toques: {zone.total_touches}</span>
                  <span>Duración: {zone.duration_hours?.toFixed(1)}h</span>
                  <span>Vol Score: {zone.volume_score?.toFixed(0)}</span>
                </div>
              </div>
            ))}
            {zones.length > 20 && (
              <div className="zdt-more">+ {zones.length - 20} zonas más</div>
            )}
          </div>
        )}

        {Object.keys(zonesByMethod).length > 0 && (
          <div className="zdt-methods-summary">
            {Object.entries(zonesByMethod).map(([m, z]) => (
              <div key={m} className="zdt-method-count">
                <span>{m}</span>
                <span>{z.length} zonas</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Renderizar resultados de evaluación
  const renderEvaluateResults = () => {
    if (!evaluateResult) return null;

    return (
      <div className="zdt-results">
        <div className="zdt-results-header">
          <h4>Resultados de Evaluación</h4>
        </div>

        <div className="zdt-metrics-grid">
          <div className="zdt-metric">
            <span className="zdt-metric-value">{evaluateResult.zones_detected}</span>
            <span className="zdt-metric-label">Zonas Detectadas</span>
          </div>
          <div className="zdt-metric">
            <span className="zdt-metric-value">{evaluateResult.zones_tradeable}</span>
            <span className="zdt-metric-label">Zonas Tradeables</span>
          </div>
          <div className="zdt-metric">
            <span className="zdt-metric-value">{(evaluateResult.tradeable_rate * 100).toFixed(1)}%</span>
            <span className="zdt-metric-label">Tasa Tradeable</span>
          </div>
          <div className="zdt-metric highlight">
            <span className="zdt-metric-value">{(evaluateResult.overall_win_rate * 100).toFixed(1)}%</span>
            <span className="zdt-metric-label">Win Rate</span>
          </div>
          <div className="zdt-metric">
            <span className="zdt-metric-value">{evaluateResult.total_bounces}</span>
            <span className="zdt-metric-label">Total Rebotes</span>
          </div>
          <div className="zdt-metric">
            <span className="zdt-metric-value">{evaluateResult.successful_bounces}</span>
            <span className="zdt-metric-label">Rebotes Exitosos</span>
          </div>
        </div>

        {evaluateResult.summary && (
          <div className="zdt-strategies">
            <h5>Estrategias Recomendadas:</h5>
            <div className="zdt-strategy-bars">
              {Object.entries(evaluateResult.summary.strategies).map(([strat, count]) => (
                <div key={strat} className="zdt-strategy-bar">
                  <span className="zdt-strategy-name">{strat.replace(/_/g, ' ')}</span>
                  <div className="zdt-strategy-progress">
                    <div
                      className={`zdt-strategy-fill ${strat.includes('avoid') ? 'negative' : 'positive'}`}
                      style={{ width: `${(count / evaluateResult.zones_detected) * 100}%` }}
                    />
                  </div>
                  <span className="zdt-strategy-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Renderizar resultados de comparación
  const renderCompareResults = () => {
    if (!compareResult) return null;

    return (
      <div className="zdt-results">
        <div className="zdt-results-header">
          <h4>Comparación de Métodos</h4>
          <span className="zdt-best-method">
            Mejor: <strong>{compareResult.best_method}</strong>
          </span>
        </div>

        <div className="zdt-compare-table">
          <table>
            <thead>
              <tr>
                <th>Método</th>
                <th>Zonas</th>
                <th>Tradeables</th>
                <th>Win Rate</th>
                <th>Rebotes</th>
                <th>Fakeout Rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(compareResult.methods).map(([m, data]) => (
                <tr key={m} className={m === compareResult.best_method ? 'best' : ''}>
                  <td>{m}</td>
                  <td>{data.zones_detected}</td>
                  <td>{data.zones_tradeable}</td>
                  <td>{(data.overall_win_rate * 100).toFixed(1)}%</td>
                  <td>{data.total_bounces}</td>
                  <td>{(data.avg_fakeout_rate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="zdt-recommendation">
          {compareResult.recommendation}
        </div>
      </div>
    );
  };

  // Renderizar resultados de optimización
  const renderOptimizeResults = () => {
    if (!optimizeResult) return null;

    return (
      <div className="zdt-results">
        <div className="zdt-results-header">
          <h4>Resultados de Optimización</h4>
          <span className="zdt-opt-type">{optimizeResult.optimization_type}</span>
        </div>

        {optimizeResult.best_params && (
          <div className="zdt-best-params">
            <h5>Mejores Parámetros Encontrados:</h5>
            <div className="zdt-params-list">
              {Object.entries(optimizeResult.best_params).map(([key, value]) => (
                <div key={key} className="zdt-param-result">
                  <span>{key.replace(/_/g, ' ')}</span>
                  <span>{typeof value === 'number' ? value.toFixed(2) : value}</span>
                </div>
              ))}
            </div>
            <button
              className="zdt-btn apply"
              onClick={() => setParams(prev => ({ ...prev, ...optimizeResult.best_params }))}
            >
              Aplicar Parámetros
            </button>
          </div>
        )}

        {optimizeResult.in_sample && optimizeResult.out_of_sample && (
          <div className="zdt-walk-forward">
            <h5>Walk-Forward Analysis:</h5>
            <div className="zdt-wf-grid">
              <div className="zdt-wf-item">
                <span>In-Sample Win Rate</span>
                <span>{(optimizeResult.in_sample.avg_win_rate * 100).toFixed(1)}%</span>
              </div>
              <div className="zdt-wf-item">
                <span>Out-of-Sample Win Rate</span>
                <span>{(optimizeResult.out_of_sample.avg_win_rate * 100).toFixed(1)}%</span>
              </div>
              <div className="zdt-wf-item">
                <span>Degradación</span>
                <span className={optimizeResult.degradation?.is_robust ? 'good' : 'bad'}>
                  {(optimizeResult.degradation?.win_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="zdt-wf-item">
                <span>¿Es Robusto?</span>
                <span className={optimizeResult.degradation?.is_robust ? 'good' : 'bad'}>
                  {optimizeResult.degradation?.is_robust ? 'Sí' : 'No'}
                </span>
              </div>
            </div>
          </div>
        )}

        {optimizeResult.summary && (
          <div className="zdt-opt-summary">
            <span>Combinaciones probadas: {optimizeResult.total_combinations_tested}</span>
            <span>Mejor fitness: {optimizeResult.best_fitness?.toFixed(2)}</span>
          </div>
        )}
      </div>
    );
  };

  // 🎯 Formatear fecha de playback para mostrar al usuario
  const formatPlaybackDate = () => {
    if (!playbackStartTime) return null;
    const date = new Date(playbackStartTime);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 🎯 NUEVO: Formatear timestamp de zona a fecha legible
  const formatZoneDate = (timestamp) => {
    if (!timestamp) return '?';
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 🎯 NUEVO: Handler para click en zona
  const handleZoneClick = (zone) => {
    // 🔍 DEBUG: Log del click
    console.log(`[ZoneDetectorTester] 🖱️ Click en zona:`, {
      id: zone.id,
      start_timestamp: zone.start_timestamp,
      end_timestamp: zone.end_timestamp,
      start_date: new Date(zone.start_timestamp).toISOString(),
      end_date: new Date(zone.end_timestamp).toISOString(),
      midTimestamp: Math.floor((zone.start_timestamp + zone.end_timestamp) / 2),
      midDate: new Date(Math.floor((zone.start_timestamp + zone.end_timestamp) / 2)).toISOString()
    });

    if (onZoneClick) {
      onZoneClick(zone);
    }
  };

  return (
    <div className="zdt-container">
      <div className="zdt-header">
        <h3>Zone Detector Tester</h3>
        <span className="zdt-symbol">{symbol} - {interval}</span>
        {onClose && (
          <button className="zdt-close" onClick={onClose}>×</button>
        )}
      </div>

      {/* 🎯 Indicador de fecha límite de datos */}
      {playbackStartTime && (
        <div className="zdt-playback-info" style={{
          background: 'rgba(74, 111, 165, 0.2)',
          borderLeft: '3px solid #4a6fa5',
          padding: '8px 12px',
          margin: '0 0 10px 0',
          fontSize: '12px'
        }}>
          <strong>📅 Fecha límite de datos:</strong> {formatPlaybackDate()}
          <br/>
          <span style={{ opacity: 0.8 }}>Solo se usarán datos anteriores a la fecha de inicio de reproducción</span>
        </div>
      )}

      <div className="zdt-tabs">
        <button
          className={activeTab === 'detect' ? 'active' : ''}
          onClick={() => setActiveTab('detect')}
        >
          Detectar
        </button>
        <button
          className={activeTab === 'evaluate' ? 'active' : ''}
          onClick={() => setActiveTab('evaluate')}
        >
          Evaluar
        </button>
        <button
          className={activeTab === 'compare' ? 'active' : ''}
          onClick={() => setActiveTab('compare')}
        >
          Comparar
        </button>
        <button
          className={activeTab === 'optimize' ? 'active' : ''}
          onClick={() => setActiveTab('optimize')}
        >
          Optimizar
        </button>
      </div>

      <div className="zdt-content">
        {/* Controles comunes */}
        <div className="zdt-controls">
          <div className="zdt-control-row">
            <label>
              Método:
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="consolidation">🎯 Consolidación (Recomendado)</option>
                <option value="pivot_cluster">Pivot Cluster</option>
                <option value="atr_based">ATR Based</option>
                <option value="volume_profile">Volume Profile</option>
                <option value="price_action">Price Action</option>
                <option value="all">Todos</option>
              </select>
            </label>

            <label>
              Días:
              <input
                type="number"
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value))}
                min={30}
                max={1095}
              />
            </label>

            <label title="Máximo % de rango de precio para considerar una zona válida (zonas más amplias serán descartadas)">
              Max Rango %:
              <input
                type="number"
                value={params.max_price_range_pct}
                onChange={(e) => setParams({...params, max_price_range_pct: parseFloat(e.target.value)})}
                min={1}
                max={20}
                step={0.5}
              />
            </label>
          </div>

          {/* Parámetros específicos del método */}
          {method !== 'all' && activeTab !== 'compare' && renderMethodParams()}
        </div>

        {/* Error */}
        {error && (
          <div className="zdt-error">{error}</div>
        )}

        {/* Acciones por tab */}
        <div className="zdt-actions">
          {activeTab === 'detect' && (
            <>
              <button
                className="zdt-btn primary"
                onClick={handleDetect}
                disabled={loading}
              >
                {loading ? 'Detectando...' : 'Detectar Zonas'}
              </button>
              {/* 🎯 NUEVO: Botón para limpiar zonas */}
              {onClearZones && detectResult?.zones?.length > 0 && (
                <button
                  className="zdt-btn secondary"
                  onClick={() => {
                    onClearZones();
                    setDetectResult(null);
                  }}
                  disabled={loading}
                  style={{ marginLeft: '8px' }}
                >
                  Limpiar Zonas
                </button>
              )}
            </>
          )}

          {activeTab === 'evaluate' && (
            <button
              className="zdt-btn primary"
              onClick={handleEvaluate}
              disabled={loading}
            >
              {loading ? 'Evaluando...' : 'Evaluar Zonas'}
            </button>
          )}

          {activeTab === 'compare' && (
            <button
              className="zdt-btn primary"
              onClick={handleCompare}
              disabled={loading}
            >
              {loading ? 'Comparando...' : 'Comparar Métodos'}
            </button>
          )}

          {activeTab === 'optimize' && (
            <div className="zdt-opt-buttons">
              <button
                className="zdt-btn primary"
                onClick={() => handleOptimize(false)}
                disabled={loading}
              >
                {loading ? 'Optimizando...' : 'Grid Search'}
              </button>
              <button
                className="zdt-btn secondary"
                onClick={() => handleOptimize(true)}
                disabled={loading}
              >
                {loading ? 'Optimizando...' : 'Walk-Forward'}
              </button>
            </div>
          )}
        </div>

        {/* Resultados */}
        {activeTab === 'detect' && renderDetectResults()}
        {activeTab === 'evaluate' && renderEvaluateResults()}
        {activeTab === 'compare' && renderCompareResults()}
        {activeTab === 'optimize' && renderOptimizeResults()}
      </div>
    </div>
  );
};

export default ZoneDetectorTester;
