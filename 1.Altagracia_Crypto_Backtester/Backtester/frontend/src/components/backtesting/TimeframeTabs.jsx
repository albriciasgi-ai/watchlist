import React from 'react';
import './TimeframeTabs.css';

/**
 * Componente de tabs para cambiar entre timeframes en backtesting
 *
 * Muestra 3 tabs fijos: 15m, 1h, 4h
 * Cada tab puede mostrar un badge con el número de órdenes abiertas en ese timeframe
 */
const TimeframeTabs = ({
  activeTimeframe,
  onTabChange,
  orderCounts = {}
}) => {
  const tabs = [
    { id: '1m', label: '1m', color: '#E91E63', emoji: '⚡' },   // 1 año de datos
    { id: '5m', label: '5m', color: '#9C27B0', emoji: '🔥' },   // 3 años de datos
    { id: '15m', label: '15m', color: '#2196F3', emoji: '📊' },
    { id: '1h', label: '1h', color: '#4CAF50', emoji: '📈' },
    { id: '4h', label: '4h', color: '#FF9800', emoji: '🏆' }
  ];

  return (
    <div className="timeframe-tabs-container">
      <div className="timeframe-tabs">
        {tabs.map(tab => {
          const isActive = activeTimeframe === tab.id;
          const orderCount = orderCounts[tab.id] || 0;

          return (
            <button
              key={tab.id}
              className={`timeframe-tab ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              style={{
                borderBottomColor: isActive ? tab.color : 'transparent',
                color: isActive ? tab.color : '#666'
              }}
              title={`Cambiar a timeframe ${tab.label}`}
            >
              <span className="tab-emoji">{tab.emoji}</span>
              <span className="tab-label">{tab.label}</span>

              {orderCount > 0 && (
                <span
                  className="tab-badge"
                  style={{ backgroundColor: tab.color }}
                >
                  {orderCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="tabs-info">
        <span className="tabs-hint">
          💡 Cada timeframe tiene sus propios dibujos
        </span>
      </div>
    </div>
  );
};

export default TimeframeTabs;
