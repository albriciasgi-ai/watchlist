import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Registrar componentes de Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const EquityCurveChart = ({ trades, initialBalance = 10000, mode, onModeChange }) => {
  // Calcular puntos de la equity curve
  const equityCurve = [];
  let balance = initialBalance;

  trades.forEach((trade, idx) => {
    balance += trade.pnl;
    const balancePercent = ((balance - initialBalance) / initialBalance) * 100;

    equityCurve.push({
      tradeNum: idx + 1,
      balance: balance,
      balancePercent: balancePercent
    });
  });

  // Determinar si la tendencia es positiva o negativa
  const finalBalance = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].balance : initialBalance;
  const isPositive = finalBalance >= initialBalance;

  const data = {
    labels: equityCurve.map(p => `T${p.tradeNum}`),
    datasets: [{
      label: mode === 'percent' ? 'Balance (%)' : 'Balance ($)',
      data: equityCurve.map(p => mode === 'percent' ? p.balancePercent : p.balance),
      borderColor: isPositive ? '#4CAF50' : '#EF5350',
      backgroundColor: isPositive ? 'rgba(76, 175, 80, 0.1)' : 'rgba(239, 83, 80, 0.1)',
      fill: true,
      tension: 0.4,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: isPositive ? '#4CAF50' : '#EF5350',
      borderWidth: 2
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#333',
        bodyColor: '#666',
        borderColor: '#E0E0E0',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (mode === 'percent') {
              label += context.parsed.y.toFixed(2) + '%';
            } else {
              label += '$' + context.parsed.y.toFixed(2);
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          maxTicksLimit: 10,
          color: '#666'
        }
      },
      y: {
        grid: {
          color: '#F0F0F0'
        },
        ticks: {
          color: '#666',
          callback: function(value) {
            if (mode === 'percent') {
              return value.toFixed(1) + '%';
            } else {
              return '$' + value.toFixed(0);
            }
          }
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>Equity Curve</h3>
        <div className="chart-controls">
          <button
            className={`mode-toggle-btn ${mode === 'percent' ? 'active' : ''}`}
            onClick={() => onModeChange('percent')}
            title="Mostrar en porcentaje"
          >
            %
          </button>
          <button
            className={`mode-toggle-btn ${mode === 'absolute' ? 'active' : ''}`}
            onClick={() => onModeChange('absolute')}
            title="Mostrar en dólares"
          >
            $
          </button>
        </div>
      </div>
      <div className="chart-content" style={{ height: '280px' }}>
        {equityCurve.length > 0 ? (
          <Line data={data} options={options} />
        ) : (
          <div className="no-data-message">
            No hay trades cerrados aún
          </div>
        )}
      </div>
      {equityCurve.length > 0 && (
        <div className="chart-footer">
          <div className="stat-item">
            <span className="stat-label">Balance Inicial:</span>
            <span className="stat-value">${initialBalance.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Balance Final:</span>
            <span className={`stat-value ${isPositive ? 'positive' : 'negative'}`}>
              ${finalBalance.toFixed(2)}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Cambio:</span>
            <span className={`stat-value ${isPositive ? 'positive' : 'negative'}`}>
              {isPositive ? '+' : ''}{((finalBalance - initialBalance) / initialBalance * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
export default React.memo(EquityCurveChart);
