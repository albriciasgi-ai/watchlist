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
import useUiTheme from '../../useUiTheme.js';
import { chartFont, dashboardPalette, tooltipFonts } from './dashboardPalette.js';

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

/** Botones de modo: [modo, texto, ayuda]. App 1 usa estos; el journal de la suite pasa '$' y 'R' */
const DEFAULT_MODES = [
  ['percent', '%', 'Mostrar en porcentaje'],
  ['absolute', '$', 'Mostrar en dólares'],
];

/**
 * Opcionales (13/11/2026, para el journal de la suite; App 1 no los pasa y dibuja como siempre):
 * - themed: colores y letra del estilo elegido (dashboardPalette.js);
 * - modes: los botones de modo. El modo 'r' acumula el R de cada trade (trade.r);
 * - summary: [{ label, value, tone: 'positive' | 'negative' }] en lugar del pie de saldo inicial y final.
 */
const EquityCurveChart = ({ trades, initialBalance = 10000, mode, onModeChange, themed = false, modes = DEFAULT_MODES, summary = null }) => {
  useUiTheme(); // Con themed, vuelve a pintar al cambiar el estilo
  const palette = dashboardPalette(themed);

  // Calcular puntos de la equity curve
  const equityCurve = [];
  let balance = initialBalance;
  let r = 0;

  trades.forEach((trade, idx) => {
    balance += trade.pnl;
    r += Number.isFinite(trade.r) ? trade.r : 0;
    const balancePercent = initialBalance ? ((balance - initialBalance) / initialBalance) * 100 : 0;

    equityCurve.push({
      tradeNum: idx + 1,
      balance: balance,
      balancePercent: balancePercent,
      r
    });
  });

  const valueOf = (point) => (mode === 'percent' ? point.balancePercent : mode === 'r' ? point.r : point.balance);
  const unit = mode === 'percent' ? '%' : mode === 'r' ? 'R' : '$';

  // Determinar si la tendencia es positiva o negativa
  const last = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : null;
  const finalBalance = last ? last.balance : initialBalance;
  const isPositive = mode === 'r' ? (last ? last.r >= 0 : true) : finalBalance >= initialBalance;

  const data = {
    labels: equityCurve.map(p => `T${p.tradeNum}`),
    datasets: [{
      label: `Balance (${unit})`,
      data: equityCurve.map(valueOf),
      borderColor: isPositive ? palette.win : palette.loss,
      backgroundColor: isPositive ? palette.winFill : palette.lossFill,
      fill: true,
      tension: 0.4,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: isPositive ? palette.win : palette.loss,
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
        backgroundColor: palette.tooltipBg,
        titleColor: palette.tooltipTitle,
        bodyColor: palette.tooltipBody,
        borderColor: palette.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        ...tooltipFonts(palette),
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (mode === 'percent') {
              label += context.parsed.y.toFixed(2) + '%';
            } else if (mode === 'r') {
              label += context.parsed.y.toFixed(2) + ' R';
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
          color: palette.muted,
          ...chartFont(palette)
        }
      },
      y: {
        grid: {
          color: palette.grid
        },
        ticks: {
          color: palette.muted,
          ...chartFont(palette),
          callback: function(value) {
            if (mode === 'percent') {
              return value.toFixed(1) + '%';
            } else if (mode === 'r') {
              return value.toFixed(1) + ' R';
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
          {modes.map(([id, text, title]) => (
            <button
              key={id}
              className={`mode-toggle-btn ${mode === id ? 'active' : ''}`}
              onClick={() => onModeChange(id)}
              title={title}
            >
              {text}
            </button>
          ))}
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
      {equityCurve.length > 0 && summary && (
        <div className="chart-footer">
          {summary.map(item => (
            <div className="stat-item" key={item.label}>
              <span className="stat-label">{item.label}:</span>
              <span className={`stat-value ${item.tone || ''}`}>{item.value}</span>
            </div>
          ))}
        </div>
      )}
      {equityCurve.length > 0 && !summary && (
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
