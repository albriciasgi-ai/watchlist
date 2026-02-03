import React, { useState, useEffect } from 'react'
import { API_BASE_URL } from '../config'
import './TradeDetail.css'

function TradeDetail({ tradeId, onBack, onDeleted }) {
  const [trade, setTrade] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({})
  const [screenshotErrors, setScreenshotErrors] = useState({})
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (tradeId) {
      fetchTrade()
    }
  }, [tradeId])

  const fetchTrade = async () => {
    try {
      setLoading(true)
      setError(null)
      setScreenshotErrors({})
      const res = await fetch(`${API_BASE_URL}/api/entries/${tradeId}`)
      if (!res.ok) throw new Error('Trade no encontrado')
      const data = await res.json()
      // La API devuelve {success: true, entry: {...}}, extraer el entry
      const tradeData = data.entry || data
      setTrade(tradeData)
      setEditData({
        notes: tradeData.reflection?.notes || '',
        lessons: tradeData.reflection?.lessons || '',
        emotions_before: tradeData.reflection?.emotions_before || '',
        emotions_after: tradeData.reflection?.emotions_after || '',
        setup_quality: tradeData.setup?.quality || 5,
        followed_rules: tradeData.execution?.followed_rules ?? true,
        execution_notes: tradeData.execution?.notes || '',
        stop_loss: tradeData.setup?.stop_loss || '',
        take_profit: tradeData.setup?.take_profit || ''
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
          quality: editData.setup_quality,
          stop_loss: editData.stop_loss ? parseFloat(editData.stop_loss) : null,
          take_profit: editData.take_profit ? parseFloat(editData.take_profit) : null
        },
        execution: {
          ...trade.execution,
          followed_rules: editData.followed_rules,
          notes: editData.execution_notes
        }
      }

      const res = await fetch(`${API_BASE_URL}/api/entries/${tradeId}`, {
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

  const handleDelete = async () => {
    if (!confirm(`Estas seguro de eliminar este trade de ${trade.symbol}? Esta accion no se puede deshacer.`)) {
      return
    }

    try {
      setDeleting(true)
      const res = await fetch(`${API_BASE_URL}/api/entries/${tradeId}`, {
        method: 'DELETE'
      })

      if (!res.ok) throw new Error('Error al eliminar')

      if (onDeleted) onDeleted()
      onBack()
    } catch (err) {
      console.error('Error deleting trade:', err)
      alert('Error al eliminar el trade')
      setDeleting(false)
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
      'open': { class: 'badge-blue', text: 'Abierto' },
      'OPEN': { class: 'badge-blue', text: 'Abierto' },
      'closed_tp': { class: 'badge-green', text: 'TP' },
      'closed_sl': { class: 'badge-red', text: 'SL' },
      'closed_manual': { class: 'badge-gray', text: 'Manual' },
      'closed_be': { class: 'badge-yellow', text: 'BE' },
      'CLOSED': { class: 'badge-green', text: 'Cerrado' },
      'cancelled': { class: 'badge-yellow', text: 'Cancelado' },
      'CANCELLED': { class: 'badge-yellow', text: 'Cancelado' }
    }
    const s = statusMap[status] || { class: 'badge-gray', text: status || 'Desconocido' }
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

  // Construye la URL correcta para screenshots
  // Las rutas pueden venir como:
  // - "screenshots/BTCUSDT/file.png" (relativa)
  // - "screenshots\BTCUSDT\file.png" (Windows backslash)
  // - "BTCUSDT/file.png" (solo el path relativo)
  const getScreenshotUrl = (path) => {
    if (!path) return null
    // Normalizar backslashes a forward slashes
    let normalizedPath = path.replace(/\\/g, '/')
    // Remover "screenshots/" del inicio si existe
    normalizedPath = normalizedPath.replace(/^\/?screenshots\//, '')
    // Construir URL final - usar el mount de archivos estaticos
    return `${API_BASE_URL}/screenshots/${normalizedPath}`
  }

  const handleScreenshotError = (type) => {
    setScreenshotErrors(prev => ({ ...prev, [type]: true }))
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
      <div className="detail-header">
        <button className="btn btn-icon" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="header-info">
          <h2>
            <span className={`direction-icon ${trade.direction?.toLowerCase()}`}>
              {trade.direction === 'LONG' ? '+' : '-'}
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
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(true)}>
                Editar
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="detail-content">
        <div className="detail-main">
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

          <div className="screenshots-section">
            <h3>Screenshots</h3>
            <div className="screenshots-grid">
              <div className="screenshot-card">
                <span className="screenshot-label">Entrada</span>
                {trade.screenshot_entry && !screenshotErrors.entry ? (
                  <img
                    src={getScreenshotUrl(trade.screenshot_entry)}
                    alt="Entry screenshot"
                    className="screenshot-img"
                    onError={() => handleScreenshotError('entry')}
                  />
                ) : (
                  <div className="screenshot-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span>{screenshotErrors.entry ? 'Error al cargar' : 'Sin screenshot'}</span>
                  </div>
                )}
              </div>
              <div className="screenshot-card">
                <span className="screenshot-label">Salida</span>
                {trade.screenshot_exit && !screenshotErrors.exit ? (
                  <img
                    src={getScreenshotUrl(trade.screenshot_exit)}
                    alt="Exit screenshot"
                    className="screenshot-img"
                    onError={() => handleScreenshotError('exit')}
                  />
                ) : (
                  <div className="screenshot-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span>{screenshotErrors.exit ? 'Error al cargar' : 'Sin screenshot'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Detalles del Trade</h3>
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Direccion</span>
                <span className={`detail-value direction ${trade.direction?.toLowerCase()}`}>
                  {trade.direction === 'LONG' ? '+ Long' : '- Short'}
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
                {editing ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editData.stop_loss}
                    onChange={e => setEditData({ ...editData, stop_loss: e.target.value })}
                    placeholder="Precio SL"
                    className="detail-input"
                  />
                ) : (
                  <span className="detail-value mono">
                    {trade.setup?.stop_loss ? `$${trade.setup.stop_loss.toFixed(2)}` : '-'}
                  </span>
                )}
              </div>
              <div className="detail-item">
                <span className="detail-label">Take Profit</span>
                {editing ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editData.take_profit}
                    onChange={e => setEditData({ ...editData, take_profit: e.target.value })}
                    placeholder="Precio TP"
                    className="detail-input"
                  />
                ) : (
                  <span className="detail-value mono">
                    {trade.setup?.take_profit ? `$${trade.setup.take_profit.toFixed(2)}` : '-'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="detail-sidebar">
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
                  Segui mis reglas
                </label>
              ) : (
                <span className={trade.execution?.followed_rules ? 'success' : 'warning'}>
                  {trade.execution?.followed_rules ? '+ Segui mis reglas' : '- No segui mis reglas'}
                </span>
              )}
            </div>
          </div>

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
              <label>Despues del trade</label>
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

          <div className="card">
            <h3>Lecciones Aprendidas</h3>
            {editing ? (
              <textarea
                value={editData.lessons}
                onChange={e => setEditData({ ...editData, lessons: e.target.value })}
                placeholder="Que aprendiste de este trade?"
                rows={3}
              />
            ) : (
              <p className="notes-text">{trade.reflection?.lessons || 'Sin lecciones registradas'}</p>
            )}
          </div>

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
