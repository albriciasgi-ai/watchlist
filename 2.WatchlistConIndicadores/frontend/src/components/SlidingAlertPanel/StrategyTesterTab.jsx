import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const PROFILES_KEY = 'watchlist_strategy_profiles';
const ACTIVE_PROFILE_KEY = 'watchlist_active_profile';

/**
 * Tab de Tester de Estrategias
 * Permite hacer backtesting sobre datos históricos del símbolo en fullscreen
 */
const StrategyTesterTab = ({ isOpen, fullscreenSymbol, fullscreenInterval }) => {
  const [profiles, setProfiles] = useState(() => {
    try {
      const stored = localStorage.getItem(PROFILES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [activeProfileId, setActiveProfileId] = useState(() => {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
  });
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [testResults, setTestResults] = useState([]);
  const [riskAmount, setRiskAmount] = useState(100);
  const [testDays, setTestDays] = useState(30);
  const [showNewProfileForm, setShowNewProfileForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Guardar perfiles en localStorage
  useEffect(() => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    if (activeProfileId) {
      localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
    }
  }, [activeProfileId]);

  // Perfil activo
  const activeProfile = useMemo(() => {
    return profiles.find(p => p.id === activeProfileId) || null;
  }, [profiles, activeProfileId]);

  // Crear nuevo perfil
  const handleCreateProfile = () => {
    if (!newProfileName.trim()) return;

    const newProfile = {
      id: `profile_${Date.now()}`,
      name: newProfileName.trim(),
      createdAt: Date.now(),
      symbol: fullscreenSymbol || 'BTCUSDT',
      interval: fullscreenInterval || '15',
      results: [],
      settings: {
        riskAmount: 100,
        testDays: 30
      }
    };

    setProfiles([...profiles, newProfile]);
    setActiveProfileId(newProfile.id);
    setNewProfileName('');
    setShowNewProfileForm(false);
    setTestResults([]);
  };

  // Eliminar perfil
  const handleDeleteProfile = (profileId) => {
    setProfiles(profiles.filter(p => p.id !== profileId));
    if (activeProfileId === profileId) {
      setActiveProfileId(profiles.length > 1 ? profiles[0].id : null);
      setTestResults([]);
    }
  };

  // Seleccionar perfil
  const handleSelectProfile = (profileId) => {
    setActiveProfileId(profileId);
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      setTestResults(profile.results || []);
      setRiskAmount(profile.settings?.riskAmount || 100);
      setTestDays(profile.settings?.testDays || 30);
    }
  };

  // Evaluar estrategia con datos históricos
  const runBacktest = useCallback(async () => {
    if (!fullscreenSymbol || !fullscreenInterval) {
      alert('Necesitas tener un símbolo en fullscreen para hacer backtesting');
      return;
    }

    setIsEvaluating(true);
    setTestResults([]);

    try {
      // Fetch historical candles
      const response = await fetch(
        `${API_BASE_URL}/api/historical/${fullscreenSymbol}?interval=${fullscreenInterval}&days=${testDays}`
      );

      if (!response.ok) {
        throw new Error('Error fetching historical data');
      }

      const data = await response.json();
      const candles = data.success ? (data.data || data.candles || []) : [];

      if (candles.length === 0) {
        alert('No se encontraron datos históricos');
        return;
      }

      // Fetch alerts from global history for this symbol/interval
      const GLOBAL_KEY = 'watchlist_global_alert_history';
      const stored = localStorage.getItem(GLOBAL_KEY);
      const allAlerts = stored ? JSON.parse(stored) : [];

      // Filter alerts for this symbol/interval
      const symbolAlerts = allAlerts.filter(
        a => a.symbol === fullscreenSymbol && a.interval === fullscreenInterval
      );

      if (symbolAlerts.length === 0) {
        // No hay alertas históricas, intentar detectar patrones simulados
        alert('No hay alertas históricas para este símbolo. Activa los indicadores y genera alertas primero.');
        return;
      }

      // Evaluate each alert against historical data
      const evaluatedResults = symbolAlerts.map(alert => {
        if (!alert.entry || !alert.stopLoss || !alert.takeProfit) {
          return { ...alert, outcome: 'INCOMPLETE', reason: 'Sin datos de estrategia' };
        }

        const alertTime = alert.timestamp;
        const sl = alert.stopLoss;
        const tp = alert.takeProfit;
        const direction = alert.direction;

        // Get candles after alert
        const getCandleTime = (c) => {
          const t = c.timestamp || c.time || c.openTime || c.start;
          return t < 1000000000000 ? t * 1000 : t;
        };

        const candlesAfterAlert = candles
          .filter(c => getCandleTime(c) > alertTime)
          .sort((a, b) => getCandleTime(a) - getCandleTime(b));

        if (candlesAfterAlert.length === 0) {
          return { ...alert, outcome: 'PENDING', reason: 'Sin datos posteriores' };
        }

        // Evaluate
        for (const candle of candlesAfterAlert) {
          const high = parseFloat(candle.high);
          const low = parseFloat(candle.low);

          if (direction === 'LONG') {
            if (low <= sl) {
              return { ...alert, outcome: 'LOSS', exitPrice: sl, exitTime: getCandleTime(candle) };
            }
            if (high >= tp) {
              return { ...alert, outcome: 'WIN', exitPrice: tp, exitTime: getCandleTime(candle) };
            }
          } else if (direction === 'SHORT') {
            if (high >= sl) {
              return { ...alert, outcome: 'LOSS', exitPrice: sl, exitTime: getCandleTime(candle) };
            }
            if (low <= tp) {
              return { ...alert, outcome: 'WIN', exitPrice: tp, exitTime: getCandleTime(candle) };
            }
          }
        }

        return { ...alert, outcome: 'PENDING', reason: 'Trade aún abierto' };
      });

      setTestResults(evaluatedResults);

      // Guardar resultados en el perfil
      if (activeProfileId) {
        setProfiles(profiles.map(p =>
          p.id === activeProfileId
            ? {
                ...p,
                results: evaluatedResults,
                symbol: fullscreenSymbol,
                interval: fullscreenInterval,
                lastTestAt: Date.now(),
                settings: { riskAmount, testDays }
              }
            : p
        ));
      }

    } catch (error) {
      console.error('Error in backtest:', error);
      alert('Error al ejecutar backtest: ' + error.message);
    } finally {
      setIsEvaluating(false);
    }
  }, [fullscreenSymbol, fullscreenInterval, testDays, activeProfileId, profiles, riskAmount]);

  // Calcular estadísticas
  const stats = useMemo(() => {
    const wins = testResults.filter(r => r.outcome === 'WIN').length;
    const losses = testResults.filter(r => r.outcome === 'LOSS').length;
    const pending = testResults.filter(r => r.outcome === 'PENDING').length;
    const completed = wins + losses;
    const winRate = completed > 0 ? (wins / completed * 100).toFixed(1) : 0;

    // Calculate P/L
    let totalPL = 0;
    testResults.forEach(r => {
      if (r.outcome === 'WIN') {
        const slPercent = Math.abs(r.slPercent || 0);
        const tpPercent = Math.abs(r.tpPercent || 0);
        const rr = slPercent > 0 ? tpPercent / slPercent : 0;
        totalPL += riskAmount * rr;
      } else if (r.outcome === 'LOSS') {
        totalPL -= riskAmount;
      }
    });

    return { wins, losses, pending, completed, winRate, totalPL, total: testResults.length };
  }, [testResults, riskAmount]);

  // Funciones de formato
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${parseFloat(value).toFixed(2)}`;
  };

  const getOutcomeClass = (outcome) => {
    if (outcome === 'WIN') return 'outcome-win';
    if (outcome === 'LOSS') return 'outcome-loss';
    return 'outcome-pending';
  };

  return (
    <>
      {/* Toolbar */}
      <div className="panel-toolbar tester-toolbar">
        <div className="toolbar-left">
          <div className="symbol-display">
            <span className="symbol-label">Símbolo:</span>
            <span className={`symbol-value ${fullscreenSymbol ? '' : 'no-symbol'}`}>
              {fullscreenSymbol ? `${fullscreenSymbol} (${fullscreenInterval})` : 'Sin fullscreen'}
            </span>
          </div>
        </div>
        <div className="toolbar-right">
          <div className="test-config">
            <label>Días:</label>
            <input
              type="number"
              value={testDays}
              onChange={(e) => setTestDays(parseInt(e.target.value) || 7)}
              min="1"
              max="365"
              className="days-input"
            />
          </div>
          <div className="risk-input-container">
            <label>Riesgo:</label>
            <div className="risk-input-wrapper">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                value={riskAmount}
                onChange={(e) => setRiskAmount(parseFloat(e.target.value) || 0)}
                min="0"
                step="10"
                className="risk-input"
              />
            </div>
          </div>
          <button
            className={`toolbar-btn run-btn ${isEvaluating ? 'evaluating' : ''}`}
            onClick={runBacktest}
            disabled={isEvaluating || !fullscreenSymbol}
            title="Ejecutar backtest"
          >
            {isEvaluating ? '⏳ Evaluando...' : '▶️ Ejecutar Test'}
          </button>
        </div>
      </div>

      {/* Profiles bar */}
      <div className="profiles-bar">
        <div className="profiles-list">
          {profiles.map(profile => (
            <button
              key={profile.id}
              className={`profile-btn ${profile.id === activeProfileId ? 'active' : ''}`}
              onClick={() => handleSelectProfile(profile.id)}
            >
              <span className="profile-name">{profile.name}</span>
              {profile.results?.length > 0 && (
                <span className="profile-count">{profile.results.length}</span>
              )}
              <button
                className="profile-delete"
                onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                title="Eliminar perfil"
              >
                ×
              </button>
            </button>
          ))}
          {!showNewProfileForm ? (
            <button className="profile-btn add-profile" onClick={() => setShowNewProfileForm(true)}>
              + Nuevo Perfil
            </button>
          ) : (
            <div className="new-profile-form">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Nombre del perfil"
                className="profile-name-input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
              />
              <button className="profile-save" onClick={handleCreateProfile}>✓</button>
              <button className="profile-cancel" onClick={() => { setShowNewProfileForm(false); setNewProfileName(''); }}>✕</button>
            </div>
          )}
        </div>
      </div>

      {/* Stats summary */}
      {testResults.length > 0 && (
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-label">Total</span>
            <span className="stat-value">{stats.total}</span>
          </div>
          <div className="stat-item wins">
            <span className="stat-label">Wins</span>
            <span className="stat-value">{stats.wins}</span>
          </div>
          <div className="stat-item losses">
            <span className="stat-label">Losses</span>
            <span className="stat-value">{stats.losses}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Pending</span>
            <span className="stat-value">{stats.pending}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Win Rate</span>
            <span className="stat-value">{stats.winRate}%</span>
          </div>
          <div className={`stat-item ${stats.totalPL >= 0 ? 'profit' : 'loss'}`}>
            <span className="stat-label">P/L</span>
            <span className="stat-value">{stats.totalPL >= 0 ? '+' : ''}${stats.totalPL.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="panel-content">
        {!fullscreenSymbol ? (
          <div className="empty-state">
            <span className="empty-icon">🔍</span>
            <p>Abre un símbolo en fullscreen</p>
            <p className="empty-hint">El tester usa el símbolo que tengas en pantalla completa</p>
          </div>
        ) : testResults.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">🧪</span>
            <p>Listo para testing</p>
            <p className="empty-hint">
              {activeProfile
                ? `Perfil: ${activeProfile.name} • Click "Ejecutar Test" para evaluar`
                : 'Crea un perfil y ejecuta el test'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="alerts-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Indicador</th>
                  <th>Dirección</th>
                  <th>Entrada</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Resultado</th>
                  <th>Salida</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map((result, index) => (
                  <tr key={result.id || index} className={result.direction === 'LONG' ? 'direction-long' : 'direction-short'}>
                    <td className="cell-date">{formatDate(result.timestamp)}</td>
                    <td className="cell-time">{formatTime(result.timestamp)}</td>
                    <td className="cell-indicator">
                      <span className={`indicator-badge ${result.indicator?.toLowerCase()}`}>
                        {result.indicator}
                      </span>
                    </td>
                    <td className="cell-direction">
                      <span className={`direction-badge ${result.direction?.toLowerCase()}`}>
                        {result.direction}
                      </span>
                    </td>
                    <td className="cell-price">{formatPrice(result.entry)}</td>
                    <td className="cell-sl">{formatPrice(result.stopLoss)}</td>
                    <td className="cell-tp">{formatPrice(result.takeProfit)}</td>
                    <td className="cell-outcome">
                      <span className={`outcome-badge ${getOutcomeClass(result.outcome)}`}>
                        {result.outcome}
                      </span>
                    </td>
                    <td className="cell-exit">
                      {result.exitPrice ? formatPrice(result.exitPrice) : (result.reason || '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="panel-footer">
        <span className="footer-info">
          {activeProfile
            ? `Perfil: ${activeProfile.name} • ${fullscreenSymbol || 'Sin símbolo'}`
            : 'Selecciona o crea un perfil para guardar resultados'}
        </span>
      </div>
    </>
  );
};

export default StrategyTesterTab;
