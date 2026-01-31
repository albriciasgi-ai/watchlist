import React, { useEffect, useRef, useState } from 'react';
import './components.css';

const LogsPanel = ({ logs = [], maxHeight = '400px', onClear }) => {
  const logsEndRef = useRef(null);
  const logsContainerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollToBottom = () => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const handleScroll = () => {
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isScrolledToBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isScrolledToBottom);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';

    try {
      const date = new Date(timestamp);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      const ms = date.getMilliseconds().toString().padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${ms}`;
    } catch {
      return timestamp;
    }
  };

  const getLogLevelClass = (level) => {
    switch (level?.toLowerCase()) {
      case 'error':
        return 'log-error';
      case 'warning':
      case 'warn':
        return 'log-warning';
      case 'success':
        return 'log-success';
      case 'info':
      default:
        return 'log-info';
    }
  };

  const getLogLevelIcon = (level) => {
    switch (level?.toLowerCase()) {
      case 'error':
        return 'X';
      case 'warning':
      case 'warn':
        return '!';
      case 'success':
        return 'V';
      case 'info':
      default:
        return 'i';
    }
  };

  const handleClearLogs = () => {
    if (onClear) {
      onClear();
    }
  };

  return (
    <div className="logs-panel">
      <div className="logs-header">
        <h3>System Logs</h3>
        <div className="logs-controls">
          <label className="auto-scroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
          {onClear && (
            <button
              className="btn btn-small btn-secondary"
              onClick={handleClearLogs}
              title="Clear logs"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div
        className="logs-container"
        ref={logsContainerRef}
        onScroll={handleScroll}
        style={{ maxHeight }}
      >
        {logs.length === 0 ? (
          <div className="logs-empty">
            <p>No logs yet. Activity will appear here.</p>
          </div>
        ) : (
          <>
            {logs.map((log, index) => (
              <div
                key={index}
                className={`log-entry ${getLogLevelClass(log.level)}`}
              >
                <span className="log-timestamp">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className="log-level-icon">
                  {getLogLevelIcon(log.level)}
                </span>
                <span className="log-level">
                  [{log.level?.toUpperCase() || 'INFO'}]
                </span>
                <span className="log-message">
                  {log.message}
                </span>
                {log.details && (
                  <div className="log-details">
                    {typeof log.details === 'object'
                      ? JSON.stringify(log.details, null, 2)
                      : log.details
                    }
                  </div>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </>
        )}
      </div>

      <div className="logs-footer">
        <span className="logs-count">
          {logs.length} log{logs.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};

export default LogsPanel;
