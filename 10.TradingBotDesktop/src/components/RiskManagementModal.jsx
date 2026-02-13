import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const RiskManagementModal = ({ isOpen, onClose }) => {
  const [riskAmount, setRiskAmount] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('');
  const [dailyInfo, setDailyInfo] = useState({
    used: 0,
    limit: 0,
    trades: 0,
    remaining: 0
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [symbols, setSymbols] = useState([]);
  const [currentRiskAmounts, setCurrentRiskAmounts] = useState({});

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setDailyLimit(data.daily_risk_limit > 0 ? data.daily_risk_limit.toString() : '');
        setDailyInfo({
          used: data.daily_risk_used || 0,
          limit: data.daily_risk_limit || 0,
          trades: data.daily_risk_trades || 0,
          remaining: data.daily_risk_limit > 0
            ? Math.max(0, data.daily_risk_limit - (data.daily_risk_used || 0))
            : 0
        });
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }, []);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/config`);
      if (res.ok) {
        const data = await res.json();
        const coins = data.coins || [];
        setSymbols(coins.map(c => c.symbol));
        const amounts = {};
        coins.forEach(c => {
          amounts[c.symbol] = c.risk_amount;
        });
        setCurrentRiskAmounts(amounts);
        if (coins.length > 0 && !riskAmount) {
          setRiskAmount(coins[0].risk_amount.toString());
        }
      }
    } catch (err) {
      console.error('Failed to fetch configs:', err);
    }
  }, [riskAmount]);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      fetchConfigs();
    }
  }, [isOpen, fetchSettings, fetchConfigs]);

  // Auto-refresh daily info every 10s when open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(fetchSettings, 10000);
    return () => clearInterval(interval);
  }, [isOpen, fetchSettings]);

  const showMsg = (type, text) => {
    setMessage({ type, text });
    if (type === 'success') {
      setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    }
  };

  const handleSaveRisk = async () => {
    const amount = parseFloat(riskAmount);
    if (!amount || amount <= 0) {
      showMsg('error', 'El monto de riesgo debe ser mayor a 0');
      return;
    }

    setLoading(true);
    try {
      if (applyToAll) {
        const res = await fetch(`${API_BASE_URL}/api/config/update-risk-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ risk_amount: amount })
        });
        const data = await res.json();
        if (res.ok) {
          showMsg('success', `Risk amount $${amount} aplicado a ${data.updated_count || symbols.length} monedas`);
          fetchConfigs();
        } else {
          showMsg('error', data.detail || data.error || 'Error al guardar');
        }
      } else {
        showMsg('error', 'Selecciona "Aplicar a todas las monedas" o edita monedas individuales en Configuration');
      }
    } catch (err) {
      showMsg('error', 'Error de red: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDailyLimit = async () => {
    const limit = dailyLimit ? parseFloat(dailyLimit) : 0;
    if (limit < 0) {
      showMsg('error', 'El limite diario no puede ser negativo');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/daily-risk-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_risk_limit: limit })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', limit > 0
          ? `Limite diario establecido: $${limit}`
          : 'Limite diario desactivado');
        fetchSettings();
      } else {
        showMsg('error', data.detail || data.error || 'Error al guardar');
      }
    } catch (err) {
      showMsg('error', 'Error de red: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetDaily = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/daily-risk-reset`, {
        method: 'POST'
      });
      if (res.ok) {
        showMsg('success', 'Contadores diarios reseteados');
        fetchSettings();
      } else {
        showMsg('error', 'Error al resetear contadores');
      }
    } catch (err) {
      showMsg('error', 'Error de red: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const usedPercent = dailyInfo.limit > 0
    ? Math.min(100, (dailyInfo.used / dailyInfo.limit) * 100)
    : 0;
  const isLimitReached = dailyInfo.limit > 0 && dailyInfo.used >= dailyInfo.limit;

  // Check if all symbols have same risk_amount
  const amounts = Object.values(currentRiskAmounts);
  const allSame = amounts.length > 0 && amounts.every(a => a === amounts[0]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content risk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Risk Management</h3>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="modal-body">
          {message.text && (
            <div className={`alert alert-${message.type}`}>
              {message.text}
            </div>
          )}

          {/* ---- RISK AMOUNT SECTION ---- */}
          <div className="risk-section">
            <h4 className="risk-section-title">Risk Amount per Trade</h4>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label>Monto a arriesgar (USDT)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                className="form-input"
                value={riskAmount}
                onChange={(e) => setRiskAmount(e.target.value)}
                placeholder="Ej: 10.0"
                disabled={loading}
              />
            </div>

            <div className="risk-checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                  disabled={loading}
                />
                <span>Aplicar a todas las monedas ({symbols.length})</span>
              </label>
            </div>

            {!allSame && (
              <div className="risk-amounts-summary">
                <small style={{ color: 'var(--text-muted)' }}>
                  Valores actuales distintos entre monedas. Usa el checkbox para unificar.
                </small>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleSaveRisk}
              disabled={loading || !applyToAll}
              style={{ marginTop: '8px', width: '100%' }}
            >
              {loading ? 'Guardando...' : 'Guardar Risk Amount'}
            </button>
          </div>

          {/* ---- DAILY RISK LIMIT SECTION ---- */}
          <div className="risk-section" style={{ marginTop: '24px' }}>
            <h4 className="risk-section-title">Daily Risk Limit</h4>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label>Maximo a arriesgar por dia (USDT, 0 = sin limite)</label>
              <input
                type="number"
                step="1"
                min="0"
                className="form-input"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                placeholder="Ej: 50"
                disabled={loading}
              />
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSaveDailyLimit}
              disabled={loading}
              style={{ marginBottom: '16px', width: '100%' }}
            >
              {loading ? 'Guardando...' : 'Guardar Limite Diario'}
            </button>

            {/* Daily progress */}
            {dailyInfo.limit > 0 && (
              <div className="daily-progress-section">
                <div className="daily-progress-header">
                  <span>Riesgo usado hoy</span>
                  <span className={isLimitReached ? 'daily-limit-reached' : ''}>
                    ${dailyInfo.used.toFixed(2)} / ${dailyInfo.limit.toFixed(2)}
                  </span>
                </div>

                <div className="daily-progress-bar">
                  <div
                    className={`daily-progress-fill ${isLimitReached ? 'limit-reached' : usedPercent > 75 ? 'limit-warning' : ''}`}
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>

                <div className="daily-progress-stats">
                  <div className="daily-stat">
                    <span className="daily-stat-label">Trades hoy</span>
                    <span className="daily-stat-value">{dailyInfo.trades}</span>
                  </div>
                  <div className="daily-stat">
                    <span className="daily-stat-label">Restante</span>
                    <span className="daily-stat-value">${dailyInfo.remaining.toFixed(2)}</span>
                  </div>
                  <div className="daily-stat">
                    <span className="daily-stat-label">Usado</span>
                    <span className="daily-stat-value">{usedPercent.toFixed(1)}%</span>
                  </div>
                </div>

                {isLimitReached && (
                  <div className="alert alert-error" style={{ marginTop: '12px', fontSize: '13px' }}>
                    LIMITE ALCANZADO - Las alertas seran rechazadas hasta manana o hasta resetear el contador.
                  </div>
                )}

                <button
                  className="btn btn-small btn-secondary"
                  onClick={handleResetDaily}
                  disabled={loading}
                  style={{ marginTop: '12px' }}
                >
                  Resetear Contadores
                </button>
              </div>
            )}

            {dailyInfo.limit <= 0 && (
              <div className="alert alert-info" style={{ fontSize: '13px' }}>
                Sin limite diario configurado. Todas las alertas seran procesadas sin restriccion.
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default RiskManagementModal;
