import React from 'react';
import { Bar } from 'react-chartjs-2';
import { priceLabel } from '../blindClock.js';
import useUiTheme from '../../useUiTheme.js';
import { chartFont, dashboardPalette, tooltipFonts } from './dashboardPalette.js';
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

/** Botones de modo: [modo, texto, ayuda]. App 1 usa estos; el journal de la suite suma 'R' */
const DEFAULT_MODES = [
  ['percent', '%', 'Mostrar en porcentaje'],
  ['absolute', '$', 'Mostrar en dólares'],
];

/**
 * Opcionales (13/11/2026, para el journal de la suite; App 1 no los pasa y dibuja como siempre):
 * - themed: colores y letra del estilo elegido (dashboardPalette.js);
 * - modes: los botones de modo. El modo 'r' muestra el R de cada trade (trade.r);
 * - formatPrice: cómo se escriben entrada y salida en el tooltip (la suite opera monedas de 0.0001 a 100,000);
 * - tooltipExtra(trade): líneas más para el tooltip, como la moneda y el origen.
 */
const ProfitLossHistogram = ({ trades, mode, onModeChange, themed = false, modes = DEFAULT_MODES, formatPrice = priceLabel, tooltipExtra = null }) => {
  useUiTheme(); // Con themed, vuelve a pintar al cambiar el estilo
  const palette = dashboardPalette(themed);

  // Preparar datos del histograma
  const labels = trades.map((t, idx) => `T${idx + 1}`);
  const pnlData = trades.map(t => (mode === 'percent' ? t.pnlPercent : mode === 'r' ? (Number.isFinite(t.r) ? t.r : 0) : t.pnl));
  const colors = trades.map(t => t.pnl > 0 ? palette.win : palette.loss);

  const data = {
    labels: labels,
    datasets: [{
      label: mode === 'percent' ? 'PnL (%)' : mode === 'r' ? 'PnL (R)' : 'PnL ($)',
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
        backgroundColor: palette.tooltipBg,
        titleColor: palette.tooltipTitle,
        bodyColor: palette.tooltipBody,
        borderColor: palette.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        ...tooltipFonts(palette),
        callbacks: {
          label: function(context) {
            const trade = trades[context.dataIndex];
            let label = 'PnL: ';
            if (mode === 'percent') {
              label += context.parsed.y.toFixed(2) + '%';
            } else if (mode === 'r') {
              label += Number.isFinite(trade.r) ? context.parsed.y.toFixed(2) + ' R' : 'sin R (sin SL)';
            } else {
              label += '$' + context.parsed.y.toFixed(2);
            }
            label += `\nSide: ${trade.side.toUpperCase()}`;
            label += `\nEntry: ${formatPrice(trade.entryPrice)}`;
            label += `\nExit: ${formatPrice(trade.exitPrice)}`;
            const lines = label.split('\n');
            return tooltipExtra ? [...lines, ...tooltipExtra(trade)] : lines;
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
