import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Registrar componentes de Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const ProfitLossHistogram = ({ trades, mode, onModeChange }) => {
  // Preparar datos del histograma
  const labels = trades.map((t, idx) => `T${idx + 1}`);
  const pnlData = trades.map(t => mode === 'percent' ? t.pnlPercent : t.pnl);
  const colors = trades.map(t => t.pnl > 0 ? '#4CAF50' : '#EF5350');

  const data = {
    labels: labels,
    datasets: [{
      label: mode === 'percent' ? 'PnL (%)' : 'PnL ($)',
      data: pnlData,
      backgroundColor: colors,
      borderColor: colors,
      borderWidth: 1
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
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#333',
        bodyColor: '#666',
        borderColor: '#E0E0E0',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function(context) {
            const trade = trades[context.dataIndex];
            let label = 'PnL: ';
            if (mode === 'percent') {
              label += context.parsed.y.toFixed(2) + '%';
            } else {
              label += '$' + context.parsed.y.toFixed(2);
            }
            label += `\nSide: ${trade.side.toUpperCase()}`;
            label += `\nEntry: $${trade.entryPrice.toFixed(2)}`;
            label += `\nExit: $${trade.exitPrice.toFixed(2)}`;
            return label.split('\n');
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
          maxTicksLimit: 15,
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
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const index = elements[0].index;
        const trade = trades[index];
        console.log('Trade clicked:', trade);
        // Aquí se podría agregar funcionalidad adicional como mostrar detalles o navegar al trade
      }
    }
  };

  // Calcular estadísticas
  const totalWins = trades.filter(t => t.pnl > 0).length;
  const totalLosses = trades.filter(t => t.pnl <= 0).length;
  const avgPnl = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length
    : 0;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>Profit/Loss por Trade</h3>
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
        {trades.length > 0 ? (
          <Bar data={data} options={options} />
        ) : (
          <div className="no-data-message">
            No hay trades cerrados aún
          </div>
        )}
      </div>
      {trades.length > 0 && (
        <div className="chart-footer">
          <div className="stat-item">
            <span className="stat-label">Ganadores:</span>
            <span className="stat-value positive">{totalWins}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Perdedores:</span>
            <span className="stat-value negative">{totalLosses}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">PnL Promedio:</span>
            <span className={`stat-value ${avgPnl >= 0 ? 'positive' : 'negative'}`}>
              ${avgPnl.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfitLossHistogram;
