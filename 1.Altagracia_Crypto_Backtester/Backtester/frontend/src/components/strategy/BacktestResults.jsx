// BacktestResults.jsx
// Componente para mostrar los resultados del backtesting de una estrategia

import React, { useState, useMemo } from 'react';
import './BacktestResults.css';

// Formatear número con decimales
const formatNumber = (num, decimals = 2) => {
  if (num === null || num === undefined) return '-';
  return Number(num).toFixed(decimals);
};

// Formatear moneda
const formatCurrency = (num) => {
  if (num === null || num === undefined) return '-';
  return `$${Number(num).toFixed(2)}`;
};

// Formatear porcentaje
const formatPercent = (num) => {
  if (num === null || num === undefined) return '-';
  const prefix = num >= 0 ? '+' : '';
  return `${prefix}${Number(num).toFixed(2)}%`;
};

// Formatear timestamp a fecha legible
const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Formatear duración en minutos a texto legible
const formatDuration = (minutes) => {
  if (!minutes) return '-';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

const BacktestResults = ({ result, onClose, onViewTrade }) => {
  const [activeTab, setActiveTab] = useState('summary'); // summary, trades, equity

  if (!result) {
    return (
      <div className="br-container br-empty">
        <p>No hay resultados de backtest disponibles.</p>
        <p className="br-hint">Ejecuta un backtest desde el Strategy Builder para ver los resultados aquí.</p>
      </div>
    );
  }

  const { metrics, trades, equity_curve, initial_capital, final_capital, execution_time_ms } = result;

  // Calcular estadísticas adicionales
  const stats = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    const longTrades = trades.filter(t => t.side === 'long');
    const shortTrades = trades.filter(t => t.side === 'short');
    const winningTrades = trades.filter(t => t.result === 'win');
    const losingTrades = trades.filter(t => t.result === 'loss');

    return {
      longCount: longTrades.length,
      shortCount: shortTrades.length,
      longWinRate: longTrades.length > 0
        ? (longTrades.filter(t => t.result === 'win').length / longTrades.length * 100)
        : 0,
      shortWinRate: shortTrades.length > 0
        ? (shortTrades.filter(t => t.result === 'win').length / shortTrades.length * 100)
        : 0,
      bestTrade: trades.reduce((best, t) => t.pnl > (best?.pnl || -Infinity) ? t : best, null),
      worstTrade: trades.reduce((worst, t) => t.pnl < (worst?.pnl || Infinity) ? t : worst, null),
      avgWinPct: winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnl_percent, 0) / winningTrades.length
        : 0,
      avgLossPct: losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.pnl_percent, 0) / losingTrades.length
        : 0
    };
  }, [trades]);

  return (
    <div className="br-container">
      {/* Header */}
      <div className="br-header">
        <div className="br-header-left">
          <h3>Resultados del Backtest</h3>
          <span className="br-execution-time">Ejecutado en {execution_time_ms}ms</span>
        </div>
        <div className="br-header-right">
          {onClose && (
            <button onClick={onClose} className="br-close-btn">×</button>
          )}
        </div>
      </div>

      {/* Resumen rápido */}
      <div className="br-quick-summary">
        <div className={`br-summary-card ${metrics.total_pnl >= 0 ? 'positive' : 'negative'}`}>
          <span className="label">PnL Total</span>
          <span className="value">{formatCurrency(metrics.total_pnl)}</span>
          <span className="subvalue">{formatPercent(metrics.total_pnl_percent)}</span>
        </div>
        <div className="br-summary-card">
          <span className="label">Win Rate</span>
          <span className="value">{formatNumber(metrics.win_rate, 1)}%</span>
          <span className="subvalue">{metrics.winning_trades}W / {metrics.losing_trades}L</span>
        </div>
        <div className="br-summary-card">
          <span className="label">Profit Factor</span>
          <span className={`value ${metrics.profit_factor >= 1.5 ? 'good' : metrics.profit_factor < 1 ? 'bad' : ''}`}>
            {metrics.profit_factor === Infinity ? '∞' : formatNumber(metrics.profit_factor, 2)}
          </span>
          <span className="subvalue">Objetivo: &gt;1.5</span>
        </div>
        <div className="br-summary-card">
          <span className="label">Max Drawdown</span>
          <span className={`value ${metrics.max_drawdown_percent > 10 ? 'bad' : ''}`}>
            {formatPercent(-metrics.max_drawdown_percent)}
          </span>
          <span className="subvalue">{formatCurrency(metrics.max_drawdown)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="br-tabs">
        <button
          className={activeTab === 'summary' ? 'active' : ''}
          onClick={() => setActiveTab('summary')}
        >
          Resumen
        </button>
        <button
          className={activeTab === 'trades' ? 'active' : ''}
          onClick={() => setActiveTab('trades')}
        >
          Trades ({metrics.total_trades})
        </button>
        <button
          className={activeTab === 'equity' ? 'active' : ''}
          onClick={() => setActiveTab('equity')}
        >
          Equity Curve
        </button>
      </div>

      {/* Content */}
      <div className="br-content">
        {/* Summary Tab */}
        {activeTab === 'summary' && stats && (
          <div className="br-summary-grid">
            <div className="br-section">
              <h4>Rendimiento General</h4>
              <div className="br-metrics-grid">
                <div className="br-metric">
                  <span className="label">Capital Inicial</span>
                  <span className="value">{formatCurrency(initial_capital)}</span>
                </div>
                <div className="br-metric">
                  <span className="label">Capital Final</span>
                  <span className={`value ${final_capital >= initial_capital ? 'positive' : 'negative'}`}>
                    {formatCurrency(final_capital)}
                  </span>
                </div>
                <div className="br-metric">
                  <span className="label">Total Trades</span>
                  <span className="value">{metrics.total_trades}</span>
                </div>
                <div className="br-metric">
                  <span className="label">Tiempo Promedio</span>
                  <span className="value">{formatDuration(metrics.avg_holding_time)}</span>
                </div>
              </div>
            </div>

            <div className="br-section">
              <h4>Análisis de Trades</h4>
              <div className="br-metrics-grid">
                <div className="br-metric">
                  <span className="label">Promedio Ganador</span>
                  <span className="value positive">{formatCurrency(metrics.avg_win)}</span>
                  <span className="subvalue">{formatPercent(stats.avgWinPct)}</span>
                </div>
                <div className="br-metric">
                  <span className="label">Promedio Perdedor</span>
                  <span className="value negative">{formatCurrency(metrics.avg_loss)}</span>
                  <span className="subvalue">{formatPercent(stats.avgLossPct)}</span>
                </div>
                <div className="br-metric">
                  <span className="label">Mejor Trade</span>
                  <span className="value positive">{formatCurrency(stats.bestTrade?.pnl)}</span>
                  <span className="subvalue">{formatPercent(stats.bestTrade?.pnl_percent)}</span>
                </div>
                <div className="br-metric">
                  <span className="label">Peor Trade</span>
                  <span className="value negative">{formatCurrency(stats.worstTrade?.pnl)}</span>
                  <span className="subvalue">{formatPercent(stats.worstTrade?.pnl_percent)}</span>
                </div>
              </div>
            </div>

            <div className="br-section">
              <h4>Distribución Long/Short</h4>
              <div className="br-distribution">
                <div className="br-dist-bar">
                  <div className="br-dist-long" style={{
                    width: `${metrics.total_trades > 0 ? (stats.longCount / metrics.total_trades * 100) : 50}%`
                  }}>
                    LONG: {stats.longCount} ({formatNumber(stats.longWinRate, 0)}% win)
                  </div>
                  <div className="br-dist-short" style={{
                    width: `${metrics.total_trades > 0 ? (stats.shortCount / metrics.total_trades * 100) : 50}%`
                  }}>
                    SHORT: {stats.shortCount} ({formatNumber(stats.shortWinRate, 0)}% win)
                  </div>
                </div>
              </div>
            </div>

            <div className="br-section">
              <h4>Ratios de Riesgo</h4>
              <div className="br-metrics-grid">
                <div className="br-metric">
                  <span className="label">Sharpe Ratio</span>
                  <span className={`value ${metrics.sharpe_ratio > 1 ? 'good' : ''}`}>
                    {formatNumber(metrics.sharpe_ratio, 2)}
                  </span>
                </div>
                <div className="br-metric">
                  <span className="label">Sortino Ratio</span>
                  <span className={`value ${metrics.sortino_ratio > 1 ? 'good' : ''}`}>
                    {formatNumber(metrics.sortino_ratio, 2)}
                  </span>
                </div>
                <div className="br-metric">
                  <span className="label">Avg Trade</span>
                  <span className={`value ${metrics.avg_trade >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(metrics.avg_trade)}
                  </span>
                </div>
                <div className="br-metric">
                  <span className="label">Expectancy</span>
                  <span className={`value ${metrics.avg_trade >= 0 ? 'positive' : 'negative'}`}>
                    {formatPercent(metrics.avg_trade / initial_capital * 100)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trades Tab */}
        {activeTab === 'trades' && (
          <div className="br-trades-table-container">
            {trades && trades.length > 0 ? (
              <table className="br-trades-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th>Side</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>PnL</th>
                    <th>%</th>
                    <th>Razón</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, index) => (
                    <tr
                      key={trade.id}
                      className={`br-trade-row ${trade.result}`}
                      onClick={() => onViewTrade && onViewTrade(trade)}
                    >
                      <td>{index + 1}</td>
                      <td>{formatDate(trade.entry_time)}</td>
                      <td className={`side ${trade.side}`}>{trade.side.toUpperCase()}</td>
                      <td>{formatNumber(trade.entry_price, 2)}</td>
                      <td>{formatNumber(trade.exit_price, 2)}</td>
                      <td>{formatNumber(trade.stop_loss, 2)}</td>
                      <td>{formatNumber(trade.take_profit, 2)}</td>
                      <td className={trade.pnl >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(trade.pnl)}
                      </td>
                      <td className={trade.pnl_percent >= 0 ? 'positive' : 'negative'}>
                        {formatPercent(trade.pnl_percent)}
                      </td>
                      <td className="exit-reason">{trade.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="br-no-trades">
                No se ejecutaron trades durante el período de backtest.
              </div>
            )}
          </div>
        )}

        {/* Equity Curve Tab */}
        {activeTab === 'equity' && (
          <div className="br-equity-container">
            {equity_curve && equity_curve.length > 0 ? (
              <div className="br-equity-chart">
                <EquityCurveChart
                  data={equity_curve}
                  initialCapital={initial_capital}
                  trades={trades}
                />
              </div>
            ) : (
              <div className="br-no-data">
                No hay datos de equity curve disponibles.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Componente simple para visualizar la equity curve
const EquityCurveChart = ({ data, initialCapital, trades }) => {
  if (!data || data.length === 0) return null;

  // Calcular min/max para escalar
  const equities = data.map(d => d.equity);
  const minEquity = Math.min(...equities, initialCapital);
  const maxEquity = Math.max(...equities, initialCapital);
  const range = maxEquity - minEquity || 1;

  // Calcular puntos para el path SVG
  const width = 800;
  const height = 200;
  const padding = 20;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d.equity - minEquity) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');

  // Línea de capital inicial
  const initialY = height - padding - ((initialCapital - minEquity) / range) * (height - 2 * padding);

  // Encontrar puntos de trades para marcar
  const tradeMarkers = trades?.map(trade => {
    const entryIndex = data.findIndex(d => d.timestamp >= trade.entry_time);
    const exitIndex = data.findIndex(d => d.timestamp >= trade.exit_time);

    if (entryIndex === -1) return null;

    return {
      entryX: padding + (entryIndex / (data.length - 1)) * (width - 2 * padding),
      exitX: exitIndex !== -1 ? padding + (exitIndex / (data.length - 1)) * (width - 2 * padding) : null,
      result: trade.result
    };
  }).filter(Boolean) || [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="br-equity-svg">
      {/* Grid lines */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#333" strokeWidth="1" />
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#333" strokeWidth="1" />

      {/* Línea de capital inicial */}
      <line
        x1={padding}
        y1={initialY}
        x2={width - padding}
        y2={initialY}
        stroke="#666"
        strokeWidth="1"
        strokeDasharray="5,5"
      />

      {/* Área bajo la curva */}
      <polygon
        points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
        fill="url(#equityGradient)"
        opacity="0.3"
      />

      {/* Línea de equity */}
      <polyline
        points={points}
        fill="none"
        stroke="#4a6fa5"
        strokeWidth="2"
      />

      {/* Marcadores de trades */}
      {tradeMarkers.map((marker, i) => (
        <g key={i}>
          <circle
            cx={marker.entryX}
            cy={height - padding - 10}
            r="3"
            fill={marker.result === 'win' ? '#28a745' : '#dc3545'}
          />
        </g>
      ))}

      {/* Gradient definition */}
      <defs>
        <linearGradient id="equityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4a6fa5" />
          <stop offset="100%" stopColor="#1a1a2e" />
        </linearGradient>
      </defs>

      {/* Labels */}
      <text x={padding - 5} y={padding + 5} fill="#888" fontSize="10" textAnchor="end">
        ${formatNumber(maxEquity, 0)}
      </text>
      <text x={padding - 5} y={height - padding} fill="#888" fontSize="10" textAnchor="end">
        ${formatNumber(minEquity, 0)}
      </text>
      <text x={padding - 5} y={initialY + 4} fill="#666" fontSize="10" textAnchor="end">
        Initial
      </text>
    </svg>
  );
};

export default BacktestResults;
