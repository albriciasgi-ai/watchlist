import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const CredentialsPanel = () => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [hasCredentials, setHasCredentials] = useState(false);
  const [mode, setMode] = useState(null); // 'demo' | 'live' segun las credenciales cargadas en el bot
  // Execution method setting
  const [useIntegratedTpsl, setUseIntegratedTpsl] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    checkCredentials();
    fetchBotSettings();
  }, []);

  const checkCredentials = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/credentials/check`);
      if (response.ok) {
        const data = await response.json();
        setHasCredentials(data.has_credentials);
        setMode(data.mode || null);
        if (data.mode) {
          setIsDemo(data.mode === 'demo');
        }
      }
    } catch (error) {
      console.error('Error checking credentials:', error);
    }
  };

  const fetchBotSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        setUseIntegratedTpsl(data.use_integrated_tpsl || false);
      }
    } catch (error) {
      console.error('Error fetching bot settings:', error);
    }
  };

  const handleExecutionMethodChange = async (e) => {
    const newValue = e.target.checked;
    setSettingsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/execution-method?use_integrated=${newValue}`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setUseIntegratedTpsl(data.use_integrated_tpsl);
        setMessage({
          type: 'success',
          text: `Execution method changed to: ${data.execution_method}`
        });
        setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to change execution method' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!apiKey.trim() || !apiSecret.trim()) {
      setMessage({ type: 'error', text: 'API Key and Secret are required' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch(`${API_BASE_URL}/api/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          api_secret: apiSecret,
          demo: isDemo,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.validated === false) {
          // Guardadas, pero Bybit las rechazo (clave mala, de otro entorno o sin permisos)
          setMessage({ type: 'error', text: data.validation_message || data.message });
        } else {
          setMessage({ type: 'success', text: data.validation_message || data.message || 'Credentials saved successfully!' });
        }
        setHasCredentials(true);
        setMode(data.mode || null);
        // Clear inputs after successful save
        setApiKey('');
        setApiSecret('');
      } else {
        setMessage({ type: 'error', text: data.detail || data.error || 'Failed to save credentials' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setApiSecret('');
    setMessage({ type: '', text: '' });
  };

  return (
    <div className="credentials-panel">
      <div className="panel-header">
        <h2>Bybit API Credentials</h2>
        {hasCredentials && (
          <span className={`badge ${mode === 'live' ? 'badge-danger' : 'badge-success'}`}>
            Configured{mode === 'demo' ? ' - DEMO' : mode === 'live' ? ' - REAL' : ''}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="credentials-form">
        <div className="form-group">
          <label htmlFor="apiKey">API Key</label>
          <input
            type="text"
            id="apiKey"
            className="form-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your Bybit API Key"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="apiSecret">API Secret</label>
          <input
            type="password"
            id="apiSecret"
            className="form-input"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Enter your Bybit API Secret"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isDemo}
              onChange={(e) => setIsDemo(e.target.checked)}
              disabled={loading}
            />
            <span className="checkbox-text">
              Demo Trading Mode
              <small style={{ display: 'block', marginTop: '4px', color: '#94a3b8' }}>
                {isDemo ? 'Using api-demo.bybit.com (Demo account)' : 'Using api.bybit.com (Real money)'}
              </small>
            </span>
          </label>
        </div>

        {message.text && (
          <div className={`alert alert-${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="button-group">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Credentials'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </form>

      <div className="credentials-info">
        <h3>Security Notes:</h3>
        <ul>
          <li>Credentials are stored locally in config/credentials.json</li>
          <li>Never share your API credentials with anyone</li>
          <li>Use Demo Trading first to verify bot functionality (no risk)</li>
          <li>Enable IP restrictions on Bybit for added security</li>
          <li><strong>Demo vs Real:</strong> Demo uses separate API keys from your Bybit demo account</li>
        </ul>
      </div>

      {/* Execution Method Settings */}
      <div className="settings-section" style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #334155' }}>
        <div className="panel-header">
          <h3>Execution Method</h3>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useIntegratedTpsl}
              onChange={handleExecutionMethodChange}
              disabled={settingsLoading}
            />
            <span className="checkbox-text">
              Integrated TP/SL (1 API call)
              <small style={{ display: 'block', marginTop: '4px', color: '#94a3b8' }}>
                {useIntegratedTpsl
                  ? 'Fast mode: Market/Limit + TP + SL in single API call'
                  : 'Sequential: Market order, then TP/SL on the position'}
              </small>
            </span>
          </label>
        </div>

        <div className="credentials-info" style={{ marginTop: '12px' }}>
          <h4 style={{ marginBottom: '8px', fontSize: '14px' }}>Method Comparison:</h4>
          <ul style={{ fontSize: '13px' }}>
            <li><strong>Sequential:</strong> confirms the real fill price, then sets TP/SL on the position (slower)</li>
            <li><strong>Integrated (1 call):</strong> Faster execution, TP/SL sent with the order</li>
            <li>In both methods the bot checks the Stop Loss and closes the position if it cannot set one</li>
            <li>Integrated also supports <strong>Limit orders</strong> with TP/SL</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CredentialsPanel;
