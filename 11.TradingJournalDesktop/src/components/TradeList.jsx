import React, { useState, useEffect, useMemo } from 'react'
import { API_BASE_URL } from '../config'
import './TradeList.css'

function TradeList({ onViewTrade }) {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSymbol, setFilterSymbol] = useState('all')
  const [filterDirection, setFilterDirection] = useState('all')
  const [filterSource, setFilterSource] = useState('all')
  const [sortBy, setSortBy] = useState('entry_time')
  const [sortOrder, setSortOrder] = useState('desc')

  useEffect(() => {
    console.log('[TradeList] Iniciando polling cada 5 segundos')
    fetchTrades(true)

    const interval = setInterval(() => {
      fetchTrades(false)
    }, 5000)

    return () => {
      console.log('[TradeList] Deteniendo polling')
      clearInterval(interval)
    }
  }, [])

  const fetchTrades = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/entries?limit=500`)
      if (!res.ok) throw new Error('Error al cargar trades')
      const data = await res.json()
      const entries = data.entries || data || []
      const tradesArray = Array.isArray(entries) ? entries : []
      console.log(`[TradeList] Fetch completado: ${tradesArray.length} trades`)
      setTrades(tradesArray)
      setLoading(false)
    } catch (err) {
      console.error('[TradeList] Error fetching trades:', err)
      setError('Error al cargar trades')
      setLoading(false)
    }
  }

  const symbols = useMemo(() => {
    const unique = [...new Set(trades.map(t => t.symbol))]
    return unique.sort()
  }, [trades])

  const sources = useMemo(() => {
    const unique = [...new Set(trades.map(t => t.source).filter(Boolean))]
    return unique.sort()
  }, [trades])

  const filteredTrades = useMemo(() => {
    let result = [...trades]

    if (filterStatus !== 'all') {
      result = result.filter(t => {
        const status = (t.status || '').toLowerCase()
        if (filterStatus === 'OPEN') {
          return status === 'open'
        } else if (filterStatus === 'CLOSED') {
          // Incluir todos los tipos de cierre
          return status.startsWith('closed') || status === 'closed'
        } else if (filterStatus === 'CANCELLED') {
          return status === 'cancelled'
        }
        return true
      })
    }
    if (filterSymbol !== 'all') {
      result = result.filter(t => t.symbol === filterSymbol)
    }
    if (filterDirection !== 'all') {
      result = result.filter(t => t.direction === filterDirection)
    }
    if (filterSource !== 'all') {
      result = result.filter(t => t.source === filterSource)
    }

    result.sort((a, b) => {
      let aVal = a[sortBy]
      let bVal = b[sortBy]

      if (sortBy === 'entry_time' || sortBy === 'exit_time') {
        const parseTime = (v) => {
          if (!v) return 0
          if (/^\d{10,13}$/.test(v)) return parseInt(v, 10)
          const t = new Date(v).getTime()
          return isNaN(t) ? 0 : t
        }
        aVal = parseTime(aVal)
        bVal = parseTime(bVal)
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return 0
    })

    return result
  }, [trades, filterStatus, filterSymbol, filterDirection, filterSource, sortBy, sortOrder])

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
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
    // Bybit puede enviar timestamps en ms como string (ej: "1738900000000")
    let date
    if (/^\d{10,13}$/.test(dateStr)) {
      date = new Date(parseInt(dateStr, 10))
    } else {
      date = new Date(dateStr)
    }
    if (isNaN(date.getTime())) return '-'
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
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

  const getSourceBadge = (source) => {
    const sourceMap = {
      'watchlist': { class: 'badge-blue', text: 'Watchlist' },
      'analizador': { class: 'badge-purple', text: 'Analizador' },
      'order_flow': { class: 'badge-yellow', text: 'Order Flow' },
      'backtester': { class: 'badge-green', text: 'Backtester' },
      'manual': { class: '', text: 'Manual' }
    }
    const s = sourceMap[source] || { class: '', text: source || 'Desconocido' }
    return <span className={`badge ${s.class}`}>{s.text}</span>
  }

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <span className="sort-icon">-</span>
    return <span className="sort-icon active">{sortOrder === 'asc' ? '+' : '-'}</span>
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Cargando trades...
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
        <button className="btn btn-primary" onClick={() => fetchTrades(true)}>
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="trade-list-container">
      <div className="filters-bar">
        <div className="filter-group">
          <label>Estado</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="OPEN">Abiertos</option>
            <option value="CLOSED">Cerrados</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Simbolo</label>
          <select value={filterSymbol} onChange={e => setFilterSymbol(e.target.value)}>
            <option value="all">Todos</option>
            {symbols.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Direccion</label>
          <select value={filterDirection} onChange={e => setFilterDirection(e.target.value)}>
            <option value="all">Todas</option>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Fuente</label>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="all">Todas</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="filter-stats">
          <span>{filteredTrades.length} trades</span>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('entry_time')} className="sortable">
                  Fecha <SortIcon column="entry_time" />
                </th>
                <th onClick={() => handleSort('symbol')} className="sortable">
                  Simbolo <SortIcon column="symbol" />
                </th>
                <th>Direccion</th>
                <th>Estado</th>
                <th>Fuente</th>
                <th onClick={() => handleSort('entry_price')} className="sortable">
                  Entrada <SortIcon column="entry_price" />
                </th>
                <th onClick={() => handleSort('exit_price')} className="sortable">
                  Salida <SortIcon column="exit_price" />
                </th>
                <th onClick={() => handleSort('pnl_usd')} className="sortable">
                  P&L <SortIcon column="pnl_usd" />
                </th>
                <th onClick={() => handleSort('pnl_percent')} className="sortable">
                  % <SortIcon column="pnl_percent" />
                </th>
                <th onClick={() => handleSort('r_multiple')} className="sortable">
                  R <SortIcon column="r_multiple" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan="10" className="no-data">
                    No hay trades que coincidan con los filtros
                  </td>
                </tr>
              ) : (
                filteredTrades.map(trade => (
                  <tr
                    key={trade.id}
                    onClick={() => onViewTrade(trade.id)}
                    className="clickable"
                  >
                    <td className="date-cell">{formatDate(trade.entry_time)}</td>
                    <td className="symbol-cell">{trade.symbol}</td>
                    <td>
                      <span className={`direction ${trade.direction?.toLowerCase()}`}>
                        {trade.direction === 'LONG' ? '+ Long' : '- Short'}
                      </span>
                    </td>
                    <td>{getStatusBadge(trade.status)}</td>
                    <td>{getSourceBadge(trade.source)}</td>
                    <td className="price-cell">${trade.entry_price?.toFixed(2)}</td>
                    <td className="price-cell">
                      {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}
                    </td>
                    <td className={`pnl-cell ${getValueClass(trade.pnl_usd)}`}>
                      {formatCurrency(trade.pnl_usd)}
                    </td>
                    <td className={`pnl-cell ${getValueClass(trade.pnl_percent)}`}>
                      {formatPercent(trade.pnl_percent)}
                    </td>
                    <td className={`r-cell ${getValueClass(trade.r_multiple)}`}>
                      {formatR(trade.r_multiple)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default TradeList
