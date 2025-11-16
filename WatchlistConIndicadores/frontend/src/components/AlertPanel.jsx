import React, { useState, useEffect } from 'react';
import './AlertPanel.css';

/**
 * AlertPanel Component
 *
 * Displays alert history and allows users to manage notifications
 * Integrates with the alert system to show real-time notifications
 */
const AlertPanel = ({ alerts, onClose, onClearAlerts, onDeleteAlert }) => {
  const [filter, setFilter] = useState('all'); // 'all', 'HIGH', 'MEDIUM', 'LOW'
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAlerts = alerts.filter(alert => {
    // Filter by severity
    if (filter !== 'all' && alert.severity !== filter) {
      return false;
    }

    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        alert.title?.toLowerCase().includes(searchLower) ||
        alert.symbol?.toLowerCase().includes(searchLower) ||
        alert.description?.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'HIGH': return '#f44336';
      case 'MEDIUM': return '#ff9800';
      case 'LOW': return '#4CAF50';
      default: return '#888';
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatFullTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="alert-panel-overlay" onClick={onClose}>
      <div className="alert-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="alert-panel-header">
          <h3>🔔 Alert History</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Controls */}
        <div className="alert-panel-controls">
          <input
            type="text"
            className="alert-search"
            placeholder="Search alerts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className="alert-filters">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({alerts.length})
            </button>
            <button
              className={`filter-btn ${filter === 'HIGH' ? 'active' : ''}`}
              onClick={() => setFilter('HIGH')}
            >
              High ({alerts.filter(a => a.severity === 'HIGH').length})
            </button>
            <button
              className={`filter-btn ${filter === 'MEDIUM' ? 'active' : ''}`}
              onClick={() => setFilter('MEDIUM')}
            >
              Medium ({alerts.filter(a => a.severity === 'MEDIUM').length})
            </button>
            <button
              className={`filter-btn ${filter === 'LOW' ? 'active' : ''}`}
              onClick={() => setFilter('LOW')}
            >
              Low ({alerts.filter(a => a.severity === 'LOW').length})
            </button>
          </div>

          <button className="clear-all-btn" onClick={onClearAlerts}>
            🗑️ Clear All
          </button>
        </div>

        {/* Alert List */}
        <div className="alert-list">
          {filteredAlerts.length === 0 ? (
            <div className="no-alerts">
              <p>📭 No alerts to display</p>
              <small>Alerts will appear here when patterns are detected</small>
            </div>
          ) : (
            filteredAlerts.map((alert, index) => (
              <div
                key={alert.id || index}
                className="alert-item"
                style={{ borderLeftColor: getSeverityColor(alert.severity) }}
              >
                <div className="alert-item-header">
                  <div className="alert-item-title">
                    <span className="alert-icon">{alert.icon || '🔔'}</span>
                    <span>{alert.title}</span>
                  </div>
                  <div className="alert-item-actions">
                    <span className="alert-time" title={formatFullTime(alert.timestamp)}>
                      {formatTime(alert.timestamp)}
                    </span>
                    <button
                      className="delete-alert-btn"
                      onClick={() => onDeleteAlert(alert.id || index)}
                      title="Delete alert"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="alert-item-meta">
                  <span
                    className="severity-badge"
                    style={{ backgroundColor: getSeverityColor(alert.severity) + '33', color: getSeverityColor(alert.severity) }}
                  >
                    {alert.severity}
                  </span>
                  <span className="alert-symbol">{alert.symbol}</span>
                  {alert.interval && <span className="alert-interval">{alert.interval}</span>}
                  {alert.type && <span className="alert-type">{alert.type}</span>}
                </div>

                {alert.description && (
                  <div className="alert-item-description">
                    {alert.description}
                  </div>
                )}

                {alert.data && (
                  <div className="alert-item-data">
                    {alert.data.price && (
                      <span>Price: ${alert.data.price.toFixed(2)}</span>
                    )}
                    {alert.data.confidence && (
                      <span>Confidence: {alert.data.confidence.toFixed(1)}%</span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertPanel;
