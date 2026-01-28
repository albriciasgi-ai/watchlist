import React, { useState } from 'react';

const TradesDataGrid = ({ trades, selectedIds, onSelectionChange }) => {
  const [filterSide, setFilterSide] = useState('all'); // 'all', 'long', 'short'
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'win', 'loss'
  const [sortBy, setSortBy] = useState('id'); // 'id', 'pnl', 'pnlPercent', 'entryTime', 'exitTime'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'

  /**
   * Formatea timestamp a fecha legible
   */
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * Formatea duración del trade
   */
  const formatDuration = (entryTime, exitTime) => {
    const durationMs = exitTime - entryTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  /**
   * Obtiene emoji según razón de cierre
   */
  const getCloseReasonLabel = (reason) => {
    switch (reason) {
      case 'take_profit':
        return '🎯 TP';
      case 'stop_loss':
        return '🛑 SL';
      case 'manual':
        return '✋ Manual';
      case 'manual_close_all':
        return '✋ Close All';
      default:
        return reason;
    }
  };

  /**
   * Seleccionar/Deseleccionar todos
   */
  const handleSelectAll = () => {
    const filteredTrades = getFilteredTrades();
    if (selectedIds.length === trades.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(trades.map(t => t.id));
    }
  };

  /**
   * Toggle selección de un trade
   */
  const handleToggle = (tradeId) => {
    if (selectedIds.includes(tradeId)) {
      onSelectionChange(selectedIds.filter(id => id !== tradeId));
    } else {
      onSelectionChange([...selectedIds, tradeId]);
    }
  };

  /**
   * Filtrar trades
   */
  const getFilteredTrades = () => {
    let filtered = [...trades];

    // Filtrar por lado
    if (filterSide !== 'all') {
      filtered = filtered.filter(t => t.side === filterSide);
    }

    // Filtrar por resultado
    if (filterResult === 'win') {
      filtered = filtered.filter(t => t.pnl > 0);
    } else if (filterResult === 'loss') {
      filtered = filtered.filter(t => t.pnl <= 0);
    }

    // Ordenar
    filtered.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    return filtered;
  };

  /**
   * Cambiar criterio de ordenamiento
   */
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const filteredTrades = getFilteredTrades();
  const allSelected = selectedIds.length === trades.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < trades.length;

  return (
    <div className="trades-grid-container">
      <div className="grid-header">
        <h3>Trades Detallados ({filteredTrades.length} / {trades.length})</h3>
        <div className="grid-controls">
          {/* Filtros */}
          <select value={filterSide} onChange={(e) => setFilterSide(e.target.value)} className="filter-select">
            <option value="all">Todos los lados</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>

          <select value={filterResult} onChange={(e) => setFilterResult(e.target.value)} className="filter-select">
            <option value="all">Todos los resultados</option>
            <option value="win">Ganadores</option>
            <option value="loss">Perdedores</option>
          </select>

          {/* Botón Select All */}
          <button onClick={handleSelectAll} className="btn-select-all">
            {allSelected ? '☑ Deseleccionar Todos' : '☐ Seleccionar Todos'}
          </button>
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="no-data-message">
          {trades.length === 0 ? 'No hay trades cerrados aún' : 'No hay trades que coincidan con los filtros'}
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="trades-grid">
            <thead>
              <tr>
                <th className="th-checkbox">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={input => {
                      if (input) input.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                  />
                </th>
                <th onClick={() => handleSort('id')} className="sortable">
                  # {sortBy === 'id' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th>Side</th>
                <th onClick={() => handleSort('entryPrice')} className="sortable">
                  Entry {sortBy === 'entryPrice' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('exitPrice')} className="sortable">
                  Exit {sortBy === 'exitPrice' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th>Qty</th>
                <th onClick={() => handleSort('pnl')} className="sortable">
                  PnL ($) {sortBy === 'pnl' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('pnlPercent')} className="sortable">
                  PnL (%) {sortBy === 'pnlPercent' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('entryTime')} className="sortable">
                  Entry Time {sortBy === 'entryTime' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('exitTime')} className="sortable">
                  Exit Time {sortBy === 'exitTime' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th>Duration</th>
                <th>Reason</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map(trade => {
                const isSelected = selectedIds.includes(trade.id);
                const isWin = trade.pnl > 0;

                return (
                  <tr
                    key={trade.id}
                    className={`trade-row ${isSelected ? 'selected' : ''} ${isWin ? 'win' : 'loss'}`}
                    onClick={() => handleToggle(trade.id)}
                  >
                    <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggle(trade.id)}
                      />
                    </td>
                    <td className="td-id">#{trade.id}</td>
                    <td>
                      <span className={`badge-side ${trade.side}`}>
                        {trade.side === 'long' ? '📈' : '📉'} {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="td-number">${trade.entryPrice.toFixed(2)}</td>
                    <td className="td-number">${trade.exitPrice.toFixed(2)}</td>
                    <td className="td-number">{trade.quantity}</td>
                    <td className={`td-number ${isWin ? 'positive' : 'negative'}`}>
                      {isWin ? '+' : ''}${trade.pnl.toFixed(2)}
                    </td>
                    <td className={`td-number ${isWin ? 'positive' : 'negative'}`}>
                      {isWin ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                    </td>
                    <td className="td-date">{formatDate(trade.entryTime)}</td>
                    <td className="td-date">{formatDate(trade.exitTime)}</td>
                    <td className="td-duration">{formatDuration(trade.entryTime, trade.exitTime)}</td>
                    <td className="td-reason">
                      <span className="reason-badge">
                        {getCloseReasonLabel(trade.closeReason)}
                      </span>
                    </td>
                    <td className="td-notes">
                      {trade.notes && (
                        <span title={trade.notes} className="notes-icon">
                          📝
                        </span>
                      )}
                      {trade.notes && (
                        <span className="notes-preview">{trade.notes.substring(0, 30)}{trade.notes.length > 30 ? '...' : ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary Footer */}
      {filteredTrades.length > 0 && (
        <div className="grid-footer">
          <div className="summary-stats">
            <div className="summary-item">
              <strong>Seleccionados:</strong> {selectedIds.length} / {trades.length}
            </div>
            <div className="summary-item">
              <strong>Filtrados:</strong> {filteredTrades.length}
            </div>
            <div className="summary-item">
              <strong>Ganadores:</strong> <span className="positive">{filteredTrades.filter(t => t.pnl > 0).length}</span>
            </div>
            <div className="summary-item">
              <strong>Perdedores:</strong> <span className="negative">{filteredTrades.filter(t => t.pnl <= 0).length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
export default React.memo(TradesDataGrid);
