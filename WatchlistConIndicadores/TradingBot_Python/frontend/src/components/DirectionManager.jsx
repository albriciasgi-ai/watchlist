import { useState, useEffect } from 'react';
import './components.css';

const DIRECTION_STATES = {
  LONG: 'LONG',
  SHORT: 'SHORT',
  BOTH: 'BOTH',
  DISABLED: 'DISABLED',
};

const DirectionManager = () => {
  const [directions, setDirections] = useState({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    long: 0,
    short: 0,
    both: 0,
    disabled: 0,
  });

  useEffect(() => {
    fetchDirections();
  }, []);

  useEffect(() => {
    calculateStats();
  }, [directions]);

  const fetchDirections = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/directions');
      if (response.ok) {
        const data = await response.json();
        setDirections(data.directions || {});
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to fetch directions' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = () => {
    const symbols = Object.keys(directions);
    const total = symbols.length;
    let active = 0, long = 0, short = 0, both = 0, disabled = 0;

    symbols.forEach(symbol => {
      const dir = directions[symbol];
      if (dir === DIRECTION_STATES.DISABLED) {
        disabled++;
      } else {
        active++;
        if (dir === DIRECTION_STATES.LONG) long++;
        else if (dir === DIRECTION_STATES.SHORT) short++;
        else if (dir === DIRECTION_STATES.BOTH) both++;
      }
    });

    setStats({ total, active, long, short, both, disabled });
  };

  const updateDirection = async (symbol, direction) => {
    setUpdating(prev => ({ ...prev, [symbol]: true }));
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch('/api/directions/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol, direction }),
      });

      const data = await response.json();

      if (response.ok) {
        setDirections(prev => ({
          ...prev,
          [symbol]: direction,
        }));
        setMessage({
          type: 'success',
          text: `${symbol} direction updated to ${direction.toUpperCase()}`
        });

        // Clear message after 3 seconds
        setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update direction' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setUpdating(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const getDirectionClass = (currentDirection, buttonDirection) => {
    if (currentDirection === buttonDirection) {
      switch (buttonDirection) {
        case DIRECTION_STATES.LONG:
          return 'btn-direction btn-direction-long active';
        case DIRECTION_STATES.SHORT:
          return 'btn-direction btn-direction-short active';
        case DIRECTION_STATES.BOTH:
          return 'btn-direction btn-direction-both active';
        case DIRECTION_STATES.DISABLED:
          return 'btn-direction btn-direction-disabled active';
        default:
          return 'btn-direction';
      }
    }
    return 'btn-direction';
  };

  const sortedSymbols = Object.keys(directions).sort();

  if (loading) {
    return (
      <div className="direction-manager">
        <div className="loading-spinner">Loading directions...</div>
      </div>
    );
  }

  return (
    <div className="direction-manager">
      <div className="panel-header">
        <h2>Trading Direction Manager</h2>
        <button onClick={fetchDirections} className="btn btn-small btn-secondary">
          Refresh
        </button>
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
          <div className="stat-label">Active</div>
          <div className="stat-value">{stats.active}</div>
        </div>
        <div className="stat-card stat-long">
          <div className="stat-label">Long Only</div>
          <div className="stat-value">{stats.long}</div>
        </div>
        <div className="stat-card stat-short">
          <div className="stat-label">Short Only</div>
          <div className="stat-value">{stats.short}</div>
        </div>
        <div className="stat-card stat-both">
          <div className="stat-label">Both</div>
          <div className="stat-value">{stats.both}</div>
        </div>
        <div className="stat-card stat-disabled">
          <div className="stat-label">Disabled</div>
          <div className="stat-value">{stats.disabled}</div>
        </div>
      </div>

      <div className="directions-list">
        {sortedSymbols.length === 0 ? (
          <div className="empty-state">
            <p>No symbols configured yet.</p>
            <p>Add symbols in the Configuration Manager first.</p>
          </div>
        ) : (
          sortedSymbols.map(symbol => (
            <div key={symbol} className="direction-item">
              <div className="direction-symbol">
                <span className="symbol-name">{symbol}</span>
                <span className={`direction-badge direction-badge-${directions[symbol]}`}>
                  {directions[symbol].toUpperCase()}
                </span>
              </div>
              <div className="direction-buttons">
                <button
                  className={getDirectionClass(directions[symbol], DIRECTION_STATES.LONG)}
                  onClick={() => updateDirection(symbol, DIRECTION_STATES.LONG)}
                  disabled={updating[symbol]}
                >
                  LONG
                </button>
                <button
                  className={getDirectionClass(directions[symbol], DIRECTION_STATES.SHORT)}
                  onClick={() => updateDirection(symbol, DIRECTION_STATES.SHORT)}
                  disabled={updating[symbol]}
                >
                  SHORT
                </button>
                <button
                  className={getDirectionClass(directions[symbol], DIRECTION_STATES.BOTH)}
                  onClick={() => updateDirection(symbol, DIRECTION_STATES.BOTH)}
                  disabled={updating[symbol]}
                >
                  BOTH
                </button>
                <button
                  className={getDirectionClass(directions[symbol], DIRECTION_STATES.DISABLED)}
                  onClick={() => updateDirection(symbol, DIRECTION_STATES.DISABLED)}
                  disabled={updating[symbol]}
                >
                  DISABLED
                </button>
              </div>
              {updating[symbol] && (
                <div className="updating-indicator">Updating...</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DirectionManager;
