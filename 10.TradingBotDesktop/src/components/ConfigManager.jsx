import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const ConfigManager = () => {
  const [configs, setConfigs] = useState({});
  const [editingSymbol, setEditingSymbol] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCoin, setNewCoin] = useState({
    symbol: '',
    risk_amount: '1.0',
    stop_loss_percent: '2.0',
    take_profit_percent: '4.0',
  });
  const [addingCoin, setAddingCoin] = useState(false);
  const [addingStatus, setAddingStatus] = useState('');

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`);
      if (response.ok) {
        const data = await response.json();
        const coinsList = data.coins || [];
        const configsObj = {};
        coinsList.forEach(coin => {
          configsObj[coin.symbol] = coin;
        });
        setConfigs(configsObj);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || error.error || 'Failed to fetch configurations' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (symbol) => {
    setEditingSymbol(symbol);
    setEditValues({
      risk_amount: configs[symbol].risk_amount,
      stop_loss_percent: (configs[symbol].stop_loss_percent * 100).toFixed(2),
      take_profit_percent: (configs[symbol].take_profit_percent * 100).toFixed(2),
    });
    setMessage({ type: '', text: '' });
  };

  const cancelEditing = () => {
    setEditingSymbol(null);
    setEditValues({});
  };

  const saveConfig = async (symbol) => {
    if (!editValues.risk_amount || editValues.risk_amount <= 0) {
      setMessage({ type: 'error', text: 'Risk amount must be greater than 0' });
      return;
    }
    if (!editValues.stop_loss_percent || editValues.stop_loss_percent <= 0) {
      setMessage({ type: 'error', text: 'Stop loss percent must be greater than 0' });
      return;
    }
    if (!editValues.take_profit_percent || editValues.take_profit_percent <= 0) {
      setMessage({ type: 'error', text: 'Take profit percent must be greater than 0' });
      return;
    }

    setSaving(prev => ({ ...prev, [symbol]: true }));
    setMessage({ type: '', text: '' });

    try {
      const slDecimal = parseFloat(editValues.stop_loss_percent) / 100;
      const tpDecimal = parseFloat(editValues.take_profit_percent) / 100;

      const response = await fetch(`${API_BASE_URL}/api/config/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol,
          risk_amount: parseFloat(editValues.risk_amount),
          stop_loss_percent: slDecimal,
          take_profit_percent: tpDecimal,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setConfigs(prev => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            risk_amount: parseFloat(editValues.risk_amount),
            stop_loss_percent: slDecimal,
            take_profit_percent: tpDecimal,
          },
        }));
        setMessage({
          type: 'success',
          text: `Configuration for ${symbol} saved successfully`
        });
        setEditingSymbol(null);
        setEditValues({});

        setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save configuration' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setSaving(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const handleInputChange = (field, value) => {
    setEditValues(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const openAddModal = () => {
    setShowAddModal(true);
    setMessage({ type: '', text: '' });
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddingStatus('');
    setNewCoin({
      symbol: '',
      risk_amount: '1.0',
      stop_loss_percent: '2.0',
      take_profit_percent: '4.0',
    });
  };

  const addCoin = async () => {
    if (!newCoin.symbol.trim()) {
      setMessage({ type: 'error', text: 'Symbol is required' });
      return;
    }

    setAddingCoin(true);
    setMessage({ type: '', text: '' });
    setAddingStatus('Fetching precision data from Bybit...');

    try {
      const response = await fetch(`${API_BASE_URL}/api/config/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: newCoin.symbol.toUpperCase(),
          risk_amount: parseFloat(newCoin.risk_amount),
          stop_loss_percent: parseFloat(newCoin.stop_loss_percent) / 100,
          take_profit_percent: parseFloat(newCoin.take_profit_percent) / 100,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const precisionMsg = data.auto_precision
          ? ' (precision auto-detected from Bybit)'
          : '';
        setMessage({
          type: 'success',
          text: `Successfully added ${newCoin.symbol.toUpperCase()}${precisionMsg}`
        });
        closeAddModal();
        fetchConfigs();
        setTimeout(() => setMessage({ type: '', text: '' }), 5000);
      } else {
        setMessage({ type: 'error', text: data.detail || data.error || 'Failed to add coin' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setAddingCoin(false);
      setAddingStatus('');
    }
  };

  const sortedSymbols = Object.keys(configs).sort();

  if (loading) {
    return (
      <div className="config-manager">
        <div className="loading-spinner">Loading configurations...</div>
      </div>
    );
  }

  return (
    <div className="config-manager">
      <div className="panel-header">
        <h2>Configuration Manager</h2>
        <div className="button-group">
          <button onClick={openAddModal} className="btn btn-small btn-success">
            + Add New Coin
          </button>
          <button onClick={fetchConfigs} className="btn btn-small btn-secondary">
            Refresh
          </button>
        </div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="config-table-container">
        <table className="config-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Risk Amount (USDT)</th>
              <th>Stop Loss (%)</th>
              <th>Take Profit (%)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedSymbols.length === 0 ? (
              <tr>
                <td colSpan="5" className="empty-cell">
                  No configurations found. Check your backend configuration.
                </td>
              </tr>
            ) : (
              sortedSymbols.map(symbol => {
                const isEditing = editingSymbol === symbol;
                const config = configs[symbol];

                return (
                  <tr key={symbol} className={isEditing ? 'editing-row' : ''}>
                    <td className="symbol-cell">
                      <strong>{symbol}</strong>
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="table-input"
                          value={editValues.risk_amount}
                          onChange={(e) => handleInputChange('risk_amount', e.target.value)}
                        />
                      ) : (
                        <span className="config-value">${config.risk_amount}</span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="table-input"
                          value={editValues.stop_loss_percent}
                          onChange={(e) => handleInputChange('stop_loss_percent', e.target.value)}
                        />
                      ) : (
                        <span className="config-value">{(config.stop_loss_percent * 100).toFixed(2)}%</span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="table-input"
                          value={editValues.take_profit_percent}
                          onChange={(e) => handleInputChange('take_profit_percent', e.target.value)}
                        />
                      ) : (
                        <span className="config-value">{(config.take_profit_percent * 100).toFixed(2)}%</span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="action-buttons">
                          <button
                            className="btn btn-small btn-success"
                            onClick={() => saveConfig(symbol)}
                            disabled={saving[symbol]}
                          >
                            {saving[symbol] ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={cancelEditing}
                            disabled={saving[symbol]}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => startEditing(symbol)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="config-info">
        <h3>Configuration Guide:</h3>
        <ul>
          <li><strong>Risk Amount:</strong> Amount in USDT to risk per trade</li>
          <li><strong>Stop Loss:</strong> Percentage below/above entry for stop loss</li>
          <li><strong>Take Profit:</strong> Percentage above/below entry for take profit</li>
          <li>Changes take effect immediately after saving</li>
        </ul>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Coin</h3>
              <button className="modal-close" onClick={closeAddModal}>
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="newSymbol">Symbol (e.g., SHIBUSDT) *</label>
                <input
                  type="text"
                  id="newSymbol"
                  className="form-input"
                  value={newCoin.symbol}
                  onChange={(e) => setNewCoin({...newCoin, symbol: e.target.value.toUpperCase()})}
                  placeholder="SHIBUSDT"
                  disabled={addingCoin}
                />
              </div>
              <div className="form-group">
                <label>Risk Amount (USDT)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="form-input"
                  value={newCoin.risk_amount}
                  onChange={(e) => setNewCoin({...newCoin, risk_amount: e.target.value})}
                  disabled={addingCoin}
                />
              </div>
              <div className="form-group">
                <label>Stop Loss (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="form-input"
                  value={newCoin.stop_loss_percent}
                  onChange={(e) => setNewCoin({...newCoin, stop_loss_percent: e.target.value})}
                  disabled={addingCoin}
                />
              </div>
              <div className="form-group">
                <label>Take Profit (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="form-input"
                  value={newCoin.take_profit_percent}
                  onChange={(e) => setNewCoin({...newCoin, take_profit_percent: e.target.value})}
                  disabled={addingCoin}
                />
              </div>
              <div className="alert alert-info" style={{fontSize: '13px', marginTop: '15px'}}>
                <strong>Auto-precision:</strong> Step size, tick size, min/max quantities are automatically fetched from Bybit when you add the coin.
              </div>
              {addingStatus && (
                <div className="alert alert-warning" style={{fontSize: '13px', marginTop: '10px'}}>
                  <span className="spinner-small"></span> {addingStatus}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={addCoin}
                disabled={addingCoin || !newCoin.symbol.trim()}
              >
                {addingCoin ? 'Adding...' : 'Add Coin'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={closeAddModal}
                disabled={addingCoin}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigManager;
