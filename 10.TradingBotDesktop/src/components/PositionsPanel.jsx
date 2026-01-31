import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const PositionsPanel = () => {
  const [symbols, setSymbols] = useState([]);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchSymbols();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        refreshAllPositions();
      }, 10000); // Refresh every 10 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, symbols]);

  const fetchSymbols = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`);
      if (response.ok) {
        const data = await response.json();
        // Backend returns {success: true, coins: [...]}
        const coinsList = data.coins || [];
        const symbolList = coinsList.map(coin => coin.symbol).sort();
        setSymbols(symbolList);

        // Initialize positions
        const initialPositions = {};
        symbolList.forEach(symbol => {
          initialPositions[symbol] = null;
        });
        setPositions(initialPositions);

        // Refresh positions after loading symbols
        if (symbolList.length > 0) {
          setTimeout(() => refreshAllPositions(), 1000);
        }
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || error.error || 'Failed to fetch symbols' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const checkPosition = async (symbol) => {
    setChecking(prev => ({ ...prev, [symbol]: true }));
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch(`${API_BASE_URL}/api/position/${symbol}`);
      const data = await response.json();

      if (response.ok && data.success) {
        setPositions(prev => ({
          ...prev,
          [symbol]: {
            hasPosition: data.hasPosition || false,
            size: data.size || 0,
            side: data.side || '',
            entryPrice: data.entryPrice || '0',
            unrealizedPnl: parseFloat(data.unrealizedPnl || '0'),
            markPrice: data.markPrice || '0',
            leverage: data.leverage || '0',
            liqPrice: data.liqPrice || '0',
            lastChecked: new Date().toISOString(),
          },
        }));
      } else {
        setPositions(prev => ({
          ...prev,
          [symbol]: {
            hasPosition: false,
            error: data.error || 'Unknown error',
            lastChecked: new Date().toISOString(),
          },
        }));
        if (!data.success) {
          console.warn(`${symbol}: ${data.error}`);
        }
      }
    } catch (error) {
      setPositions(prev => ({
        ...prev,
        [symbol]: {
          hasPosition: false,
          error: error.message,
          lastChecked: new Date().toISOString(),
        },
      }));
      console.error(`Network error for ${symbol}:`, error);
    } finally {
      setChecking(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const refreshAllPositions = useCallback(async () => {
    if (symbols.length === 0) return;

    setLastUpdate(new Date().toISOString());

    // Check all symbols in parallel
    const promises = symbols.map(symbol => checkPosition(symbol));
    await Promise.all(promises);
  }, [symbols]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return date.toLocaleTimeString();
  };

  const getPositionStats = () => {
    const stats = {
      total: symbols.length,
      open: 0,
      long: 0,
      short: 0,
      closed: 0,
    };

    Object.values(positions).forEach(pos => {
      if (pos?.hasPosition) {
        stats.open++;
        if (pos.side === 'Buy') stats.long++;
        else if (pos.side === 'Sell') stats.short++;
      } else if (pos !== null) {
        stats.closed++;
      }
    });

    return stats;
  };

  const stats = getPositionStats();

  if (loading) {
    return (
      <div className="positions-panel">
        <div className="loading-spinner">Loading positions...</div>
      </div>
    );
  }

  return (
    <div className="positions-panel">
      <div className="panel-header">
        <h2>Open Positions</h2>
        <div className="position-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh (10s)</span>
          </label>
          <button
            onClick={refreshAllPositions}
            className="btn btn-small btn-secondary"
            disabled={symbols.length === 0}
          >
            Refresh All
          </button>
        </div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Symbols</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card stat-active">
          <div className="stat-label">Open Positions</div>
          <div className="stat-value">{stats.open}</div>
        </div>
        <div className="stat-card stat-long">
          <div className="stat-label">Long</div>
          <div className="stat-value">{stats.long}</div>
        </div>
        <div className="stat-card stat-short">
          <div className="stat-label">Short</div>
          <div className="stat-value">{stats.short}</div>
        </div>
      </div>

      {lastUpdate && (
        <div className="last-update">
          Last updated: {formatTimestamp(lastUpdate)}
        </div>
      )}

      <div className="positions-list">
        {symbols.length === 0 ? (
          <div className="empty-state">
            <p>No symbols configured.</p>
          </div>
        ) : (
          symbols.map(symbol => {
            const position = positions[symbol];
            const isChecking = checking[symbol];
            const hasPosition = position?.hasPosition;

            return (
              <div
                key={symbol}
                className={`position-item ${hasPosition ? 'position-active' : 'position-inactive'}`}
              >
                <div className="position-header">
                  <div className="position-symbol">
                    <span className="symbol-name">{symbol}</span>
                    {hasPosition ? (
                      <span className={`position-badge position-badge-${position.side === 'Buy' ? 'long' : 'short'}`}>
                        {position.side === 'Buy' ? 'LONG' : 'SHORT'}
                      </span>
                    ) : (
                      <span className="position-badge position-badge-closed">
                        NO POSITION
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() => checkPosition(symbol)}
                    disabled={isChecking}
                  >
                    {isChecking ? 'Checking...' : 'Check'}
                  </button>
                </div>

                {position && (
                  <div className="position-details">
                    {hasPosition ? (
                      <>
                        <div className="position-detail">
                          <span className="detail-label">Size:</span>
                          <span className="detail-value">{position.size}</span>
                        </div>
                        <div className="position-detail">
                          <span className="detail-label">Entry Price:</span>
                          <span className="detail-value">${position.entryPrice}</span>
                        </div>
                        {position.unrealizedPnl !== undefined && (
                          <div className="position-detail">
                            <span className="detail-label">Unrealized P&L:</span>
                            <span className={`detail-value ${position.unrealizedPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {position.unrealizedPnl >= 0 ? '+' : ''}{position.unrealizedPnl > 0 || position.unrealizedPnl < 0 ? `$${Math.abs(position.unrealizedPnl).toFixed(2)}` : '$0.00'}
                            </span>
                          </div>
                        )}
                        {position.markPrice && position.markPrice !== '0' && (
                          <div className="position-detail">
                            <span className="detail-label">Mark Price:</span>
                            <span className="detail-value">${position.markPrice}</span>
                          </div>
                        )}
                        {position.leverage && (
                          <div className="position-detail">
                            <span className="detail-label">Leverage:</span>
                            <span className="detail-value">{position.leverage}x</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="position-empty">
                        {position.error ? (
                          <span className="text-danger">Error: {position.error}</span>
                        ) : (
                          <span className="text-muted">No open position</span>
                        )}
                      </div>
                    )}
                    {position.lastChecked && (
                      <div className="position-timestamp">
                        Checked: {formatTimestamp(position.lastChecked)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PositionsPanel;
