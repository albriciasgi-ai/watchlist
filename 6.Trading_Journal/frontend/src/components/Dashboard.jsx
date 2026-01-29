import React, { useState, useEffect } from 'react'
import './Dashboard.css'

const API_BASE = '/api'

function Dashboard({ onViewTrade }) {
  const [stats, setStats] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [recentTrades, setRecentTrades] = useState([])
  const [equityCurve, setEquityCurve] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchDashboardData(true)  // Primera carga con spinner

    // Polling cada 5 segundos para actualización en tiempo real
    const interval = setInterval(() => {
      fetchDashboardData(false)  // Sin spinner durante polling
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const fetchDashboardData = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true)
      setError(null)

      // Fetch cada endpoint por separado para mejor manejo de errores
      let statsData = null
      let metricsData = null
      let tradesData = null
      let equityData = null

      try {
        const statsRes = await fetch(`${API_BASE}/statistics`)
        console.log('[Dashboard] statistics response:', statsRes.status)
        if (statsRes.ok) {
          statsData = await statsRes.json()
          console.log('[Dashboard] statistics data:', statsData)
        }
      } catch (e) {
        console.error('[Dashboard] statistics fetch error:', e)
      }

      try {
        const metricsRes = await fetch(`${API_BASE}/metrics?period=all`)
        console.log('[Dashboard] metrics response:', metricsRes.status)
        if (metricsRes.ok) {
          metricsData = await metricsRes.json()
          console.log('[Dashboard] metrics data:', metricsData)
        }
      } catch (e) {
        console.error('[Dashboard] metrics fetch error:', e)
      }

      try {
        const tradesRes = await fetch(`${API_BASE}/entries?limit=5`)
        console.log('[Dashboard] entries response:', tradesRes.status)
        if (tradesRes.ok) {
          tradesData = await tradesRes.json()
          console.log('[Dashboard] entries data:', tradesData)
        }
      } catch (e) {
        console.error('[Dashboard] entries fetch error:', e)
      }

      try {
        const equityRes = await fetch(`${API_BASE}/metrics/equity-curve`)
        console.log('[Dashboard] equity-curve response:', equityRes.status)
        if (equityRes.ok) {
          equityData = await equityRes.json()
          console.log('[Dashboard] equity-curve data:', equityData)
        }
      } catch (e) {
        console.error('[Dashboard] equity-curve fetch error:', e)
      }

      // Establecer los datos - mapear nombres de campos del backend
      if (statsData) {
        const stats = statsData.statistics || statsData
        // Mapear campos del backend a los que espera el frontend
        setStats({
          total_pnl: stats.total_pnl_usd || stats.total_pnl || 0,
          total_trades: stats.total_trades || 0,
          win_rate: stats.win_rate || 0,
          winning_trades: stats.winners || stats.winning_trades || 0,
          losing_trades: stats.losers || stats.losing_trades || 0,
          best_trade: stats.best_trade_usd || stats.best_trade || 0,
          worst_trade: stats.worst_trade_usd || stats.worst_trade || 0,
          avg_winner: stats.avg_pnl_usd || 0,
          avg_loser: 0
        })
      }
      if (metricsData) {
        const m = metricsData.metrics || metricsData
        setMetrics({
          profit_factor: m.profit_factor || 0,
          avg_r: m.avg_r || 0,
          max_drawdown: m.max_drawdown_pct || m.max_drawdown || 0,
          sharpe_ratio: m.sharpe_ratio || 0
        })
      }
      if (tradesData) {
        const entries = tradesData.entries || tradesData
        setRecentTrades(Array.isArray(entries) ? entries.slice(0, 5) : [])
      }
      if (equityData) {
        setEquityCurve(equityData.curve || equityData || [])
      }

      setLoading(false)
      console.log('[Dashboard] Data loaded successfully')
    } catch (err) {
      console.error('[Dashboard] Error fetching dashboard data:', err)
      setError('Error al cargar datos del dashboard')
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '$0.00'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}$${Math.abs(num).toFixed(2)}`
  }

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '0.0%'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(1)}%`
  }

  const formatR = (value) => {
    if (value === null || value === undefined) return '0.00R'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(2)}R`
  }

  const getValueClass = (value) => {
    if (value === null || value === undefined) return 'neutral'
    const num = parseFloat(value)
    if (num > 0) return 'positive'
    if (num < 0) return 'negative'
    return 'neutral'
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Cargando dashboard...
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={fetchDashboardData}>
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="dashboard">
      {/* Metric Cards Row */}
      <div className="dashboard-row stats">
        <div className="metric-card">
          <span className="label">Total P&L</span>
          <span className={`value ${getValueClass(stats?.total_pnl)}`}>
            {formatCurrency(stats?.total_pnl)}
          </span>
          <span className="subtext">{stats?.total_trades || 0} trades</span>
        </div>

        <div className="metric-card">
          <span className="label">Win Rate</span>
          <span className={`value ${(stats?.win_rate || 0) >= 50 ? 'positive' : 'negative'}`}>
            {(stats?.win_rate || 0).toFixed(1)}%
          </span>
          <span className="subtext">
            {stats?.winning_trades || 0}W / {stats?.losing_trades || 0}L
          </span>
        </div>

        <div className="metric-card">
          <span className="label">Profit Factor</span>
          <span className={`value ${(metrics?.profit_factor || 0) >= 1 ? 'positive' : 'negative'}`}>
            {(metrics?.profit_factor || 0).toFixed(2)}
          </span>
          <span className="subtext">Ratio ganancia/pérdida</span>
        </div>

        <div className="metric-card">
          <span className="label">Promedio R</span>
          <span className={`value ${getValueClass(metrics?.avg_r)}`}>
            {formatR(metrics?.avg_r)}
          </span>
          <span className="subtext">Por trade</span>
        </div>

        <div className="metric-card">
          <span className="label">Max Drawdown</span>
          <span className="value negative">
            {formatPercent(-(metrics?.max_drawdown || 0))}
          </span>
          <span className="subtext">Caída máxima</span>
        </div>

        <div className="metric-card">
          <span className="label">Sharpe Ratio</span>
          <span className={`value ${(metrics?.sharpe_ratio || 0) >= 1 ? 'positive' : 'neutral'}`}>
            {(metrics?.sharpe_ratio || 0).toFixed(2)}
          </span>
          <span className="subtext">Risk-adjusted</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="dashboard-row charts">
        {/* Equity Curve */}
        <div className="equity-curve-container">
          <div className="equity-curve-header">
            <span className="equity-curve-title">Curva de Equity</span>
          </div>
          <div className="equity-curve-chart">
            {equityCurve.length > 0 ? (
              <EquityCurveChart data={equityCurve} />
            ) : (
              <div className="empty-state">
                <p>Sin datos de equity aún</p>
              </div>
            )}
          </div>
        </div>

        {/* Win Rate Gauge */}
        <div className="performance-summary">
          <div className="card-header">
            <span className="card-title">Rendimiento</span>
          </div>
          <div className="win-rate-gauge">
            <WinRateGauge winRate={stats?.win_rate || 0} />
          </div>
          <div className="summary-grid">
            <div className="summary-item">
              <span className="summary-label">Mejor trade</span>
              <span className="summary-value" style={{ color: 'var(--accent-green)' }}>
                {formatCurrency(stats?.best_trade)}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Peor trade</span>
              <span className="summary-value" style={{ color: 'var(--accent-red)' }}>
                {formatCurrency(stats?.worst_trade)}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Prom. ganador</span>
              <span className="summary-value" style={{ color: 'var(--accent-green)' }}>
                {formatCurrency(stats?.avg_winner)}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Prom. perdedor</span>
              <span className="summary-value" style={{ color: 'var(--accent-red)' }}>
                {formatCurrency(stats?.avg_loser)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Trades Row */}
      <div className="dashboard-row tables">
        <div className="recent-trades">
          <div className="recent-trades-header">
            <span className="recent-trades-title">Trades Recientes</span>
          </div>
          {recentTrades.length > 0 ? (
            recentTrades.map(trade => (
              <div
                key={trade.id}
                className="trade-row"
                onClick={() => onViewTrade(trade.id)}
              >
                <span className="trade-symbol">{trade.symbol}</span>
                <span className={`trade-direction ${trade.direction?.toLowerCase()}`}>
                  {trade.direction === 'LONG' ? '▲ Long' : '▼ Short'}
                </span>
                <span className={`trade-pnl ${getValueClass(trade.pnl_usd)}`}>
                  {formatCurrency(trade.pnl_usd)}
                </span>
                <span className="trade-time">
                  {new Date(trade.entry_time).toLocaleDateString()}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>No hay trades registrados aún</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Simple SVG Equity Curve Chart
function EquityCurveChart({ data }) {
  // Necesitamos al menos 2 puntos para dibujar una línea
  if (!data || data.length < 2) return null

  const width = 600
  const height = 250
  const padding = { top: 20, right: 20, bottom: 30, left: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Mapear valores - el backend puede usar cumulative_pnl, pnl, o equity
  const values = data.map(d => d.cumulative_pnl ?? d.pnl ?? d.equity ?? 0)
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(0, ...values)
  const valueRange = maxValue - minValue || 1

  // Proteger contra división por cero
  const dataPoints = Math.max(data.length - 1, 1)
  const scaleX = (i) => padding.left + (i / dataPoints) * chartWidth
  const scaleY = (v) => padding.top + chartHeight - ((v - minValue) / valueRange) * chartHeight

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i)} ${scaleY(d.cumulative_pnl ?? d.pnl ?? d.equity ?? 0)}`)
    .join(' ')

  const zeroY = scaleY(0)
  const isPositive = values[values.length - 1] >= 0

  return (
    <svg className="equity-curve-svg" viewBox={`0 0 ${width} ${height}`}>
      {/* Grid lines */}
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        stroke="var(--border-color)"
        strokeDasharray="4,4"
      />

      {/* Y-axis labels */}
      <text x={padding.left - 10} y={padding.top} textAnchor="end" fill="var(--text-muted)" fontSize="10">
        ${maxValue.toFixed(0)}
      </text>
      <text x={padding.left - 10} y={zeroY} textAnchor="end" fill="var(--text-muted)" fontSize="10">
        $0
      </text>
      <text x={padding.left - 10} y={height - padding.bottom} textAnchor="end" fill="var(--text-muted)" fontSize="10">
        ${minValue.toFixed(0)}
      </text>

      {/* Equity line */}
      <path
        d={pathD}
        fill="none"
        stroke={isPositive ? 'var(--accent-green)' : 'var(--accent-red)'}
        strokeWidth="2"
      />

      {/* Gradient fill */}
      <defs>
        <linearGradient id="equityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={isPositive ? 'var(--accent-green)' : 'var(--accent-red)'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={isPositive ? 'var(--accent-green)' : 'var(--accent-red)'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${pathD} L ${scaleX(data.length - 1)} ${zeroY} L ${padding.left} ${zeroY} Z`}
        fill="url(#equityGradient)"
      />
    </svg>
  )
}

// Win Rate Gauge Component
function WinRateGauge({ winRate }) {
  const radius = 50
  const circumference = 2 * Math.PI * radius
  const progress = (winRate / 100) * circumference

  return (
    <div className="gauge-circle">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle
          className="gauge-bg"
          cx="60"
          cy="60"
          r={radius}
        />
        <circle
          className="gauge-fill"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${progress} ${circumference}`}
        />
      </svg>
      <div className="gauge-text">
        <span className="gauge-value">{winRate.toFixed(0)}%</span>
        <span className="gauge-label">Win Rate</span>
      </div>
    </div>
  )
}

export default Dashboard
