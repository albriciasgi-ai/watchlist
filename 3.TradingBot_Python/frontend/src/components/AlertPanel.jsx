import { useState } from 'react';
import './components.css';

const AlertPanel = () => {
  const [rawAlert, setRawAlert] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTrade, setManualTrade] = useState({
    symbol: '',
    side: 'Buy',
    price: '',
  });
  const [executingManual, setExecutingManual] = useState(false);

  const processAlert = async () => {
    if (!rawAlert.trim()) {
      setMessage({ type: 'error', text: 'Please paste an alert to process' });
      return;
    }

    setProcessing(true);
    setMessage({ type: '', text: '' });
    setResult(null);

    try {
      const response = await fetch('/api/alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw_alert: rawAlert }),
      });

      const data = await response.json();

      if (response.ok) {
        // Handle multiple alerts response
        const alert = data.alert || {};
        setResult({
          success: data.success,
          symbol: alert.symbol,
          side: alert.side,
          price: alert.price,
          quantity: data.quantity,
          total: data.total,
          successful: data.successful,
          failed: data.failed,
          message: data.message,
        });
        setMessage({
          type: 'success',
          text: data.message || `Processed ${data.total || 1} alert(s) successfully!`
        });
      } else {
        // Extract detailed error message
        const errorMsg = data.detail || data.error || data.message || 'Failed to process alert';
        console.error('Alert processing error:', data);
        setResult({
          success: false,
          error: errorMsg,
        });
        setMessage({ type: 'error', text: errorMsg });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
      setResult({
        success: false,
        error: error.message,
      });
    } finally {
      setProcessing(false);
    }
  };

  const clearAlert = () => {
    setRawAlert('');
    setResult(null);
    setMessage({ type: '', text: '' });
  };

  const openManualModal = () => {
    setShowManualModal(true);
    setManualTrade({
      symbol: result?.symbol || '',
      side: result?.side || 'long',
      price: result?.price || '',
    });
  };

  const closeManualModal = () => {
    setShowManualModal(false);
    setManualTrade({
      symbol: '',
      side: 'Buy',
      price: '',
    });
  };

  const executeManualTrade = async () => {
    if (!manualTrade.symbol || !manualTrade.price) {
      setMessage({ type: 'error', text: 'Symbol and price are required' });
      return;
    }

    setExecutingManual(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch('/api/trade/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: manualTrade.symbol,
          side: manualTrade.side,
          price: parseFloat(manualTrade.price),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: `Manual trade executed: ${data.message || 'Success'}`
        });
        closeManualModal();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to execute trade' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setExecutingManual(false);
    }
  };

  return (
    <div className="alert-panel">
      <div className="panel-header">
        <h2>Alert Processor</h2>
        <span className="badge badge-info">ATAS Format</span>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="alert-input-section">
        <label htmlFor="alertText">Paste ATAS Alert:</label>
        <textarea
          id="alertText"
          className="alert-textarea"
          value={rawAlert}
          onChange={(e) => setRawAlert(e.target.value)}
          placeholder="Paste your ATAS alert here...&#10;&#10;Example:&#10;BTCUSDT&#10;Long&#10;Price: 45000.00"
          rows={10}
          disabled={processing}
        />
      </div>

      <div className="button-group">
        <button
          className="btn btn-primary"
          onClick={processAlert}
          disabled={processing || !rawAlert.trim()}
        >
          {processing ? 'Processing...' : 'Process Alert'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={clearAlert}
          disabled={processing}
        >
          Clear
        </button>
        {result?.success && (
          <button
            className="btn btn-warning"
            onClick={openManualModal}
          >
            Manual Trade
          </button>
        )}
      </div>

      {result && (
        <div className={`result-panel ${result.success ? 'result-success' : 'result-error'}`}>
          <h3>{result.success ? 'Parsed Alert' : 'Error'}</h3>
          {result.success ? (
            <div className="result-details">
              {result.total > 1 && (
                <div className="result-item">
                  <span className="result-label">Summary:</span>
                  <span className="result-value">
                    {result.successful} successful, {result.failed} failed out of {result.total} alerts
                  </span>
                </div>
              )}
              <div className="result-item">
                <span className="result-label">Symbol:</span>
                <span className="result-value">{result.symbol || 'N/A'}</span>
              </div>
              <div className="result-item">
                <span className="result-label">Side:</span>
                <span className={`result-value badge badge-${result.side === 'Buy' ? 'success' : 'danger'}`}>
                  {result.side?.toUpperCase() || 'N/A'}
                </span>
              </div>
              <div className="result-item">
                <span className="result-label">Price:</span>
                <span className="result-value">${result.price?.toLocaleString() || 'N/A'}</span>
              </div>
              {result.quantity && (
                <div className="result-item">
                  <span className="result-label">Quantity:</span>
                  <span className="result-value">{result.quantity}</span>
                </div>
              )}
              {result.message && (
                <div className="result-item" style={{gridColumn: '1 / -1'}}>
                  <span className="result-label">Status:</span>
                  <div className="result-value" style={{whiteSpace: 'pre-line', marginTop: '8px'}}>
                    {result.message}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="result-error-text">
              {result.error}
            </div>
          )}
        </div>
      )}

      {showManualModal && (
        <div className="modal-overlay" onClick={closeManualModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Execute Manual Trade</h3>
              <button className="modal-close" onClick={closeManualModal}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="manualSymbol">Symbol</label>
                <input
                  type="text"
                  id="manualSymbol"
                  className="form-input"
                  value={manualTrade.symbol}
                  onChange={(e) => setManualTrade(prev => ({ ...prev, symbol: e.target.value }))}
                  placeholder="e.g., BTCUSDT"
                />
              </div>
              <div className="form-group">
                <label htmlFor="manualSide">Side</label>
                <select
                  id="manualSide"
                  className="form-select"
                  value={manualTrade.side}
                  onChange={(e) => setManualTrade(prev => ({ ...prev, side: e.target.value }))}
                >
                  <option value="Buy">Buy (Long)</option>
                  <option value="Sell">Sell (Short)</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="manualPrice">Entry Price</label>
                <input
                  type="number"
                  id="manualPrice"
                  step="0.01"
                  className="form-input"
                  value={manualTrade.price}
                  onChange={(e) => setManualTrade(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="e.g., 45000.00"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={executeManualTrade}
                disabled={executingManual}
              >
                {executingManual ? 'Executing...' : 'Execute Trade'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={closeManualModal}
                disabled={executingManual}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="alert-info">
        <h3>Supported Alert Formats:</h3>
        <ul>
          <li><strong>Format 1 (Bracket):</strong> [timestamp] [BTCUSDT] ABRIR LONG 95000</li>
          <li><strong>Format 2 (Multi-line):</strong> BTCUSDT / Buy / Price: 95000.00</li>
          <li><strong>Format 3 (Simple):</strong> BTCUSDT Long 95000</li>
          <li><strong>Multiple alerts:</strong> Separate with double newline (blank line)</li>
          <li>Bot will automatically validate and execute the trade</li>
        </ul>
      </div>
    </div>
  );
};

export default AlertPanel;
