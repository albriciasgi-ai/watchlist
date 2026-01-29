import React, { useState, useEffect } from 'react'
import './TradeDetail.css'

const API_BASE = '/api'

function TradeDetail({ tradeId, onBack }) {
  const [trade, setTrade] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({})

  useEffect(() => {
    if (tradeId) {
      fetchTrade()
    }
  }, [tradeId])

  const fetchTrade = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE}/entries/${tradeId}`)
      if (!res.ok) throw new Error('Trade no encontrado')
      const data = await res.json()
      setTrade(data)
      setEditData({
        notes: data.reflection?.notes || '',
        lessons: data.reflection?.lessons || '',
        emotions_before: data.reflection?.emotions_before || '',
        emotions_after: data.reflection?.emotions_after || '',
        setup_quality: data.setup?.quality || 5,
        followed_rules: data.execution?.followed_rules ?? true,
        execution_notes: data.execution?.notes || ''
      })
      setLoading(false)
    } catch (err) {
      console.error('Error fetching trade:', err)
      setError('Error al cargar el trade')
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      const updateData = {
        reflection: {
          notes: editData.notes,
          lessons: editData.lessons,
          emotions_before: editData.emotions_before,
          emotions_after: editData.emotions_after
        },
        setup: {
          ...trade.setup,
          quality: editData.setup_quality
        },
        execution: {
          ...trade.execution,
          followed_rules: editData.followed_rules,
          notes: editData.execution_notes
        }
      }

      const res = await fetch(`${API_BASE}/entries/${tradeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (!res.ok) throw new Error('Error al guardar')

      await fetchTrade()
      setEditing(false)
    } catch (err) {
      console.error('Error saving trade:', err)
      alert('Error al guardar los cambios')
    }
  }

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}$${Math.abs(num).toFixed(2)}`
  }

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(2)}%`
  }

  const formatR = (value) => {
    if (value === null || value === undefined) return '-'
    const num = parseFloat(value)
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(2)}R`
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getValueClass = (value) => {
    if (value === null || value === undefined) return ''
    const num = parseFloat(value)
    if (num > 0) return 'positive'
    if (num < 0) return 'negative'
    return ''
  }

  const getStatusBadge = (status) => {
    const statusMap = {
      'OPEN': { class: 'badge-blue', text: 'Abierto' },
      'CLOSED': { class: 'badge-green', text: 'Cerrado' },
      'CANCELLED': { class: 'badge-yellow', text: 'Cancelado' }
    }
    const s = statusMap[status] || { class: '', text: status }
    return <span className={`badge ${s.class}`}>{s.text}</span>
  }

  const getSourceLabel = (source) => {
    const sourceMap = {
      'watchlist': 'Watchlist',
      'analizador': 'Analizador',
      'order_flow': 'Order Flow',
      'backtester': 'Backtester',
      'manual': 'Manual'
    }
    return sourceMap[source] || source || 'Desconocido'
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Cargando trade...
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
        <button className="btn btn-secondary" onClick={onBack}>
          Volver
        </button>
      </div>
    )
  }

  if (!trade) return null

  return (
    <div className="trade-detail">
      {/* Header */}
      <div className="detail-header">
        <button className="btn btn-icon" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="header-info">
          <h2>
            <span className={`direction-icon ${trade.direction?.toLowerCase()}`}>
              {trade.direction === 'LONG' ? '▲' : '▼'}
            </span>
            {trade.symbol}
          </h2>
          {getStatusBadge(trade.status)}
        </div>
        <div className="header-actions">
          {editing ? (
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Guardar
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              Editar
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="detail-content">
        {/* Left Column - Info & Screenshots */}
        <div className="detail-main">
          {/* Summary Card */}
          <div className="card summary-card">
            <div className="summary-stats">
              <div className="stat-block">
                <span className="stat-label">P&L</span>
                <span className={`stat-value large ${getValueClass(trade.pnl_usd)}`}>
                  {formatCurrency(trade.pnl_usd)}
                </span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Porcentaje</span>
                <span className={`stat-value ${getValueClass(trade.pnl_percent)}`}>
                  {formatPercent(trade.pnl_percent)}
                </span>
              </div>
              <div className="stat-block">
                <span className="stat-label">R-Multiple</span>
                <span className={`stat-value ${getValueClass(trade.r_multiple)}`}>
                  {formatR(trade.r_multiple)}
                </span>
              </div>
            </div>
          </div>

          {/* Screenshots */}
          <div className="screenshots-section">
            <h3>Screenshots</h3>
            <div className="screenshots-grid">
              <div className="screenshot-card">
                <span className="screenshot-label">Entrada</span>
                {trade.screenshot_entry ? (
                  <img
                    src={`${API_BASE}/screenshots/${trade.screenshot_entry}`}
                    alt="Entry screenshot"
                    className="screenshot-img"
                  />
                ) : (
                  <div className="screenshot-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span>Sin screenshot</span>
                  </div>
                )}
              </div>
              <div className="screenshot-card">
                <span className="screenshot-label">Salida</span>
                {trade.screenshot_exit ? (
                  <img
                    src={`${API_BASE}/screenshots/${trade.screenshot_exit}`}
                    alt="Exit screenshot"
                    className="screenshot-img"
                  />
                ) : (
                  <div className="screenshot-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span>Sin screenshot</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Trade Details */}
          <div className="card">
            <h3>Detalles del Trade</h3>
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Dirección</span>
                <span className={`detail-value direction ${trade.direction?.toLowerCase()}`}>
                  {trade.direction === 'LONG' ? '▲ Long' : '▼ Short'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Fuente</span>
                <span className="detail-value">{getSourceLabel(trade.source)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Entrada</span>
                <span className="detail-value">{formatDate(trade.entry_time)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Salida</span>
                <span className="detail-value">{formatDate(trade.exit_time)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Precio Entrada</span>
                <span className="detail-value mono">${trade.entry_price?.toFixed(2)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Precio Salida</span>
                <span className="detail-value mono">
                  {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Stop Loss</span>
                <span className="detail-value mono">
                  {trade.setup?.stop_loss ? `$${trade.setup.stop_loss.toFixed(2)}` : '-'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Take Profit</span>
                <span className="detail-value mono">
                  {trade.setup?.take_profit ? `$${trade.setup.take_profit.toFixed(2)}` : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Reflection & Analysis */}
        <div className="detail-sidebar">
          {/* Setup Quality */}
          <div className="card">
            <h3>Calidad del Setup</h3>
            {editing ? (
              <div className="quality-slider">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={editData.setup_quality}
                  onChange={e => setEditData({ ...editData, setup_quality: parseInt(e.target.value) })}
                />
                <span className="quality-value">{editData.setup_quality}/10</span>
              </div>
            ) : (
              <div className="quality-display">
                <div className="quality-bar">
                  <div
                    className="quality-fill"
                    style={{ width: `${(trade.setup?.quality || 5) * 10}%` }}
                  />
                </div>
                <span className="quality-value">{trade.setup?.quality || 5}/10</span>
              </div>
            )}

            <div className="checkbox-item">
              {editing ? (
                <label>
                  <input
                    type="checkbox"
                    checked={editData.followed_rules}
                    onChange={e => setEditData({ ...editData, followed_rules: e.target.checked })}
                  />
                  Seguí mis reglas
                </label>
              ) : (
                <span className={trade.execution?.followed_rules ? 'success' : 'warning'}>
                  {trade.execution?.followed_rules ? '✓ Seguí mis reglas' : '✗ No seguí mis reglas'}
                </span>
              )}
            </div>
          </div>

          {/* Emotions */}
          <div className="card">
            <h3>Emociones</h3>
            <div className="emotion-group">
              <label>Antes del trade</label>
              {editing ? (
                <input
                  type="text"
                  value={editData.emotions_before}
                  onChange={e => setEditData({ ...editData, emotions_before: e.target.value })}
                  placeholder="ej: Confiado, ansioso, neutral..."
                />
              ) : (
                <p>{trade.reflection?.emotions_before || 'No registrado'}</p>
              )}
            </div>
            <div className="emotion-group">
              <label>Después del trade</label>
              {editing ? (
                <input
                  type="text"
                  value={editData.emotions_after}
                  onChange={e => setEditData({ ...editData, emotions_after: e.target.value })}
                  placeholder="ej: Satisfecho, frustrado..."
                />
              ) : (
                <p>{trade.reflection?.emotions_after || 'No registrado'}</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="card">
            <h3>Notas</h3>
            {editing ? (
              <textarea
                value={editData.notes}
                onChange={e => setEditData({ ...editData, notes: e.target.value })}
                placeholder="Notas sobre este trade..."
                rows={4}
              />
            ) : (
              <p className="notes-text">{trade.reflection?.notes || 'Sin notas'}</p>
            )}
          </div>

          {/* Lessons */}
          <div className="card">
            <h3>Lecciones Aprendidas</h3>
            {editing ? (
              <textarea
                value={editData.lessons}
                onChange={e => setEditData({ ...editData, lessons: e.target.value })}
                placeholder="¿Qué aprendiste de este trade?"
                rows={3}
              />
            ) : (
              <p className="notes-text">{trade.reflection?.lessons || 'Sin lecciones registradas'}</p>
            )}
          </div>

          {/* Market Context */}
          {trade.market_context && (
            <div className="card">
              <h3>Contexto de Mercado</h3>
              <div className="context-items">
                {trade.market_context.trend && (
                  <div className="context-item">
                    <span className="context-label">Tendencia</span>
                    <span className="context-value">{trade.market_context.trend}</span>
                  </div>
                )}
                {trade.market_context.volatility && (
                  <div className="context-item">
                    <span className="context-label">Volatilidad</span>
                    <span className="context-value">{trade.market_context.volatility}</span>
                  </div>
                )}
                {trade.market_context.key_levels && trade.market_context.key_levels.length > 0 && (
                  <div className="context-item">
                    <span className="context-label">Niveles Clave</span>
                    <span className="context-value">
                      {trade.market_context.key_levels.map(l => `$${l}`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TradeDetail
