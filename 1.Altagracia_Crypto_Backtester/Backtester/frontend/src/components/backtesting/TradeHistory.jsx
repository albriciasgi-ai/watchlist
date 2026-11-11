import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ScreenshotModal from './ScreenshotModal';
import { isBlind, maskDate, priceLabel, quantityText } from './blindClock.js';

const TradeHistory = ({ orderManager, onNavigateToTrade }) => {
  const [closedOrders, setClosedOrders] = useState([]);
  const [filterSide, setFilterSide] = useState('all'); // 'all', 'long', 'short'
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'win', 'loss'
  const [selectedTradeIndex, setSelectedTradeIndex] = useState(0); // 🎯 NUEVO: Índice del trade seleccionado
  const [screenshotOrder, setScreenshotOrder] = useState(null); // Trade cuya imagen está abierta

  /**
   * Actualiza historial periódicamente
   */
  useEffect(() => {
    if (!orderManager) return;

    const updateHistory = () => {
      setClosedOrders([...orderManager.getClosedOrders()]);
    };

    // Actualizar inmediatamente
    updateHistory();

    // Actualizar cada 2 segundos
    const interval = setInterval(updateHistory, 2000);

    return () => clearInterval(interval);
  }, [orderManager]);

  /**
   * 🎯 NUEVO: Navegación con teclado (flechas arriba/abajo)
   */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (screenshotOrder) return; // Con la imagen abierta las flechas no mueven el gráfico de atrás

      // Solo procesar si el modal está visible y hay trades filtrados
      const filteredOrders = getFilteredOrders();
      if (filteredOrders.length === 0) return;

      // Evitar conflicto con inputs enfocados
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Navegar al trade anterior (índice menor)
        const newIndex = Math.max(0, selectedTradeIndex - 1);
        setSelectedTradeIndex(newIndex);
        if (onNavigateToTrade && filteredOrders[newIndex]) {
          onNavigateToTrade(filteredOrders[newIndex]);
        }
        console.log('[TradeHistory] ⬆️ Navegando al trade anterior:', newIndex);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Navegar al trade siguiente (índice mayor)
        const newIndex = Math.min(filteredOrders.length - 1, selectedTradeIndex + 1);
        setSelectedTradeIndex(newIndex);
        if (onNavigateToTrade && filteredOrders[newIndex]) {
          onNavigateToTrade(filteredOrders[newIndex]);
        }
        console.log('[TradeHistory] ⬇️ Navegando al trade siguiente:', newIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTradeIndex, closedOrders, filterSide, filterResult, onNavigateToTrade, screenshotOrder]);

  /**
   * 🎯 NUEVO: Resetear índice seleccionado cuando cambian los filtros
   */
  useEffect(() => {
    setSelectedTradeIndex(0);
  }, [filterSide, filterResult]);

  /**
   * Filtra órdenes según criterios
   */
  const getFilteredOrders = () => {
    let filtered = [...closedOrders];

    // Filtrar por lado
    if (filterSide !== 'all') {
      filtered = filtered.filter(o => o.side === filterSide);
    }

    // Filtrar por resultado
    if (filterResult === 'win') {
      filtered = filtered.filter(o => o.pnl > 0);
    } else if (filterResult === 'loss') {
      filtered = filtered.filter(o => o.pnl <= 0);
    }

    // Ordenar por fecha de cierre (más reciente primero)
    filtered.sort((a, b) => b.exitTime - a.exitTime);

    return filtered;
  };

  /**
   * Formatea timestamp a fecha legible
   */
  const formatDate = (timestamp) => {
    if (isBlind()) return maskDate(timestamp);
    const date = new Date(timestamp);
    return date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
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
   * Formatea PnL con color
   */
  const formatPnL = (value) => {
    const isPositive = value >= 0;
    const sign = isPositive ? '+' : '';
    const color = isPositive ? '#26a69a' : '#ef5350';

    return (
      <span style={{ color, fontWeight: 'bold' }}>
        {sign}{value.toFixed(2)}
      </span>
    );
  };

  /**
   * Obtiene emoji según razón de cierre
   */
  const getCloseReasonEmoji = (reason) => {
    switch (reason) {
      case 'take_profit':
        return '🎯';
      case 'stop_loss':
        return '🛑';
      case 'manual':
      case 'manual_close_all':
        return '✋';
      default:
        return '❓';
    }
  };

  /**
   * 📍 NUEVO: Navegar al trade en el gráfico
   */
  const handleNavigateToTrade = (order, index) => {
    // Actualizar índice seleccionado
    setSelectedTradeIndex(index);

    if (onNavigateToTrade) {
      // 🎯 OPTIMIZACIÓN: Pasar index + 1 para mostrar número de trade (1-based)
      onNavigateToTrade(order, index + 1);
    }
  };

  const filteredOrders = getFilteredOrders();

  return (
    <div className="trade-history">
      <div className="history-header">
        <h3>Historial de Trades ({closedOrders.length})</h3>

        <div className="history-filters">
          <select value={filterSide} onChange={(e) => setFilterSide(e.target.value)}>
            <option value="all">Todos los lados</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>

          <select value={filterResult} onChange={(e) => setFilterResult(e.target.value)}>
            <option value="all">Todos los resultados</option>
            <option value="win">Ganadores</option>
            <option value="loss">Perdedores</option>
          </select>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="no-trades">
          {closedOrders.length === 0
            ? 'No hay trades cerrados aún'
            : 'No hay trades que coincidan con los filtros'
          }
        </div>
      ) : (
        <div className="trades-table-container">
          <table className="trades-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Lado</th>
                <th>Fecha Entrada</th>
                <th>Fecha Salida</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Cantidad</th>
                <th>PnL</th>
                <th>PnL %</th>
                <th>Duración</th>
                <th>Cierre</th>
                <th>Notas</th>
                <th>📍</th>
                <th>📸</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order, index) => (
                <tr
                  key={order.id}
                  className={`
                    ${order.pnl > 0 ? 'trade-win' : 'trade-loss'}
                    ${index === selectedTradeIndex ? 'trade-selected' : ''}
                  `.trim()}
                  onClick={() => handleNavigateToTrade(order, index)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>#{order.id}</td>
                  <td>
                    <span className={`badge-side ${order.side}`}>
                      {order.side === 'long' ? '📈' : '📉'} {order.side.toUpperCase()}
                    </span>
                  </td>
                  <td>{formatDate(order.executedAt || order.entryTime)}</td>
                  <td>{formatDate(order.exitTime)}</td>
                  <td>{priceLabel(order.entryPrice)}</td>
                  <td>{priceLabel(order.exitPrice)}</td>
                  <td>{quantityText(order.quantity)}</td>
                  <td>{formatPnL(order.pnl)}</td>
                  <td>{formatPnL(order.pnlPercent)}%</td>
                  <td>{formatDuration(order.executedAt || order.entryTime, order.exitTime)}</td>
                  <td>
                    <span title={order.closeReason}>
                      {getCloseReasonEmoji(order.closeReason)}
                    </span>
                  </td>
                  <td className="trade-notes">
                    {order.notes && (
                      <span title={order.notes}>
                        📝
                      </span>
                    )}
                  </td>
                  <td className="trade-navigate">
                    <button
                      className="navigate-button"
                      onClick={(e) => {
                        e.stopPropagation(); // Evitar doble click en la fila
                        handleNavigateToTrade(order, index);
                      }}
                      title="Ver trade en el gráfico"
                    >
                      📍
                    </button>
                  </td>
                  <td className="trade-screenshot">
                    {order.decisionScreenshotPath || order.screenshotPath || order.exitScreenshotPath ? (
                      <button
                        className="screenshot-button"
                        onClick={(e) => {
                          e.stopPropagation(); // La fila navega al trade
                          setScreenshotOrder(order);
                        }}
                        title="Ver las imágenes del trade"
                      >
                        📸
                      </button>
                    ) : (
                      <span className="no-screenshot" title="Este trade no tiene imagen">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* El panel lateral encerraría el modal: se monta en el body */}
      {screenshotOrder && createPortal(
        <ScreenshotModal
          decisionScreenshotPath={screenshotOrder.decisionScreenshotPath}
          screenshotPath={screenshotOrder.screenshotPath}
          exitScreenshotPath={screenshotOrder.exitScreenshotPath}
          orderId={screenshotOrder.id}
          side={screenshotOrder.side}
          pnl={screenshotOrder.pnl}
          onClose={() => setScreenshotOrder(null)}
        />,
        document.body
      )}
    </div>
  );
};

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
// Solo re-renderiza si orderManager cambia (las órdenes se actualizan vía useEffect interno)
export default React.memo(TradeHistory);
