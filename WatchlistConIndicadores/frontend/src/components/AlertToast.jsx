import React, { useState, useEffect } from 'react';
import './AlertToast.css';

/**
 * AlertToast Component
 *
 * Shows popup notifications for new alerts
 * Auto-dismisses after a few seconds
 */
const AlertToast = ({ alert, onDismiss, duration = 5000 }) => {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Trigger animation
    setTimeout(() => setVisible(true), 10);

    // Progress bar animation
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev - (100 / (duration / 100));
        return newProgress < 0 ? 0 : newProgress;
      });
    }, 100);

    // Auto-dismiss
    const dismissTimer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(dismissTimer);
    };
  }, [duration]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 300); // Wait for animation
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'HIGH': return '#f44336';
      case 'MEDIUM': return '#ff9800';
      case 'LOW': return '#4CAF50';
      default: return '#4a9eff';
    }
  };

  if (!alert) return null;

  return (
    <div className={`alert-toast ${visible ? 'visible' : ''}`}>
      <div
        className="alert-toast-accent"
        style={{ backgroundColor: getSeverityColor(alert.severity) }}
      />

      <div className="alert-toast-content">
        <div className="alert-toast-header">
          <span className="alert-toast-icon">{alert.icon || '🔔'}</span>
          <span className="alert-toast-title">{alert.title}</span>
          <button className="alert-toast-close" onClick={handleDismiss}>×</button>
        </div>

        {alert.description && (
          <div className="alert-toast-description">
            {alert.description.split('\n').slice(0, 2).join(' • ')}
          </div>
        )}

        <div className="alert-toast-meta">
          <span
            className="alert-toast-severity"
            style={{ color: getSeverityColor(alert.severity) }}
          >
            {alert.severity}
          </span>
          <span className="alert-toast-symbol">{alert.symbol}</span>
          {alert.interval && <span className="alert-toast-interval">{alert.interval}</span>}
        </div>
      </div>

      <div
        className="alert-toast-progress"
        style={{
          width: `${progress}%`,
          backgroundColor: getSeverityColor(alert.severity)
        }}
      />
    </div>
  );
};

/**
 * AlertToastContainer
 *
 * Manages multiple toast notifications
 */
export const AlertToastContainer = ({ alerts, onDismiss }) => {
  return (
    <div className="alert-toast-container">
      {alerts.map((alert, index) => (
        <AlertToast
          key={alert.id || index}
          alert={alert}
          onDismiss={() => onDismiss(alert.id || index)}
        />
      ))}
    </div>
  );
};

export default AlertToast;
