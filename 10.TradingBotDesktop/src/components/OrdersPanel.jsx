import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const OrdersPanel = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchOrders();
      }, 15000); // Refresh every 15 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/history`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders || []);
        setLastUpdate(new Date().toISOString());
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || error.error || 'Failed to fetch orders' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm(`Are you sure you want to delete all ${orders.length} orders from history? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/history`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        setMessage({ type: 'success', text: data.message });
        setOrders([]);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to clear history' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error: ' + error.message });
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatQuantity = (qty) => {
    if (!qty) return 'N/A';
    return parseFloat(qty).toFixed(4);
  };

  if (loading) {
    return (
      <div className="orders-panel">
        <div className="loading-spinner">Loading orders...</div>
      </div>
    );
  }

  return (
    <div className="orders-panel">
      <div className="panel-header">
        <h2>Order History</h2>
        <div className="position-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh (15s)</span>
          </label>
          <button
            onClick={fetchOrders}
            className="btn btn-small btn-secondary"
          >
            Refresh
          </button>
          {orders.length > 0 && (
            <button
              onClick={clearHistory}
              className="btn btn-small btn-danger"
              title="Delete all order history"
            >
              Clear History
            </button>
          )}
        </div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {lastUpdate && (
        <div className="last-update">
          Last updated: {formatTimestamp(lastUpdate)}
        </div>
      )}

      <div className="orders-list">
        {orders.length === 0 ? (
          <div className="empty-state">
            <p>No orders found. Execute some trades to see them here.</p>
          </div>
        ) : (
          <div className="orders-table">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Entry Price</th>
                  <th>Quantity (Coin)</th>
                  <th>Quantity (USDT)</th>
                  <th>Stop Loss</th>
                  <th>Take Profit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, index) => (
                  <tr key={index}>
                    <td>{formatTimestamp(order.timestamp)}</td>
                    <td className="symbol-cell">{order.symbol}</td>
                    <td>
                      <span className={`badge badge-${order.side === 'Buy' ? 'success' : 'danger'}`}>
                        {order.side === 'Buy' ? 'LONG' : 'SHORT'}
                      </span>
                    </td>
                    <td>{formatPrice(order.entry_price)}</td>
                    <td>{formatQuantity(order.quantity_coin)}</td>
                    <td>{formatPrice(order.quantity_usdt)}</td>
                    <td>{formatPrice(order.stop_loss)}</td>
                    <td>{formatPrice(order.take_profit)}</td>
                    <td>
                      <span className={`badge badge-${order.status === 'success' ? 'success' : order.status === 'partial' ? 'warning' : 'danger'}`}>
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="orders-summary">
        <div className="stat-card">
          <div className="stat-label">Total Orders</div>
          <div className="stat-value">{orders.length}</div>
        </div>
        <div className="stat-card stat-success">
          <div className="stat-label">Successful</div>
          <div className="stat-value">{orders.filter(o => o.status === 'success').length}</div>
        </div>
        <div className="stat-card stat-warning">
          <div className="stat-label">Partial</div>
          <div className="stat-value">{orders.filter(o => o.status === 'partial').length}</div>
        </div>
        <div className="stat-card stat-danger">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{orders.filter(o => o.status === 'failed').length}</div>
        </div>
      </div>
    </div>
  );
};

export default OrdersPanel;
