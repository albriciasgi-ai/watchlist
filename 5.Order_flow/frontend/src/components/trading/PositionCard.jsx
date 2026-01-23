// src/components/trading/PositionCard.jsx
// Muestra la posición activa de un símbolo
import React, { useMemo } from 'react';

const PositionCard = ({ position, loading, symbol }) => {
  // Calcular PnL porcentual
  const pnlData = useMemo(() => {
    if (!position) {
      console.log('[PositionCard] No position provided');
      return null;
    }

    const size = parseFloat(position.size) || 0;
    // El backend puede devolver entryPrice o avgPrice
    const entryPrice = parseFloat(position.entryPrice || position.avgPrice) || 0;
    const markPrice = parseFloat(position.markPrice) || 0;
    // El backend puede devolver unrealizedPnl (con z) o unrealisedPnl (con s)
    const unrealisedPnl = parseFloat(position.unrealizedPnl || position.unrealisedPnl) || 0;

    // Calcular PnL porcentual
    const investment = size * entryPrice;
    const pnlPercent = investment > 0 ? (unrealisedPnl / investment) * 100 : 0;

    console.log('[PositionCard] Parsed data:', { size, entryPrice, markPrice, unrealisedPnl, investment, pnlPercent });

    return {
      size,
      entryPrice,
      markPrice,
      unrealisedPnl,
      pnlPercent,
      investment
    };
  }, [position]);

  if (loading && !position) {
    return (
      <div className="position-card">
        <div className="position-loading">
          <span className="spinner"></span>
          Cargando posicion...
        </div>
      </div>
    );
  }

  if (!position || !pnlData || pnlData.size === 0) {
    console.log('[PositionCard] Not rendering - position:', !!position, 'pnlData:', !!pnlData, 'size:', pnlData?.size);
    return null; // No mostrar si no hay posición
  }

  const isLong = position.side === 'Buy';
  const isProfitable = pnlData.unrealisedPnl >= 0;

  return (
    <div className="position-card">
      <div className="position-card-header">
        <h4>
          📊 Posicion Activa
        </h4>
        <span className={`position-side-badge ${isLong ? 'long' : 'short'}`}>
          {isLong ? '📈 LONG' : '📉 SHORT'}
        </span>
      </div>

      <div className="position-grid">
        {/* Cantidad */}
        <div className="position-item">
          <div className="label">Cantidad</div>
          <div className="value">
            {pnlData.size.toFixed(6)} {symbol.replace('USDT', '')}
          </div>
        </div>

        {/* Inversión */}
        <div className="position-item">
          <div className="label">Inversion</div>
          <div className="value">
            ${pnlData.investment.toFixed(2)}
          </div>
        </div>

        {/* Entry Price */}
        <div className="position-item">
          <div className="label">Entry Price</div>
          <div className="value">
            ${pnlData.entryPrice.toFixed(2)}
          </div>
        </div>

        {/* Mark Price */}
        <div className="position-item">
          <div className="label">Mark Price</div>
          <div className="value">
            ${pnlData.markPrice.toFixed(2)}
          </div>
        </div>

        {/* SL/TP si están disponibles */}
        {position.stopLoss && (
          <div className="position-item">
            <div className="label">Stop Loss</div>
            <div className="value" style={{ color: '#ef4444' }}>
              ${parseFloat(position.stopLoss).toFixed(2)}
            </div>
          </div>
        )}

        {position.takeProfit && (
          <div className="position-item">
            <div className="label">Take Profit</div>
            <div className="value" style={{ color: '#10b981' }}>
              ${parseFloat(position.takeProfit).toFixed(2)}
            </div>
          </div>
        )}

        {/* PnL destacado */}
        <div className={`position-item full-width pnl-highlight ${isProfitable ? '' : 'negative'}`}>
          <div className="label">PnL No Realizado</div>
          <div className={`value ${isProfitable ? 'positive' : 'negative'}`}>
            {isProfitable ? '+' : ''}{pnlData.unrealisedPnl.toFixed(2)} USDT
            <span style={{
              marginLeft: '8px',
              fontSize: '12px',
              opacity: 0.8
            }}>
              ({isProfitable ? '+' : ''}{pnlData.pnlPercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Leverage si está disponible */}
        {position.leverage && (
          <div className="position-item">
            <div className="label">Leverage</div>
            <div className="value">
              {position.leverage}x
            </div>
          </div>
        )}

        {/* Liquidation Price si está disponible */}
        {position.liqPrice && parseFloat(position.liqPrice) > 0 && (
          <div className="position-item">
            <div className="label">Liq. Price</div>
            <div className="value" style={{ color: '#f59e0b' }}>
              ${parseFloat(position.liqPrice).toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '8px',
          fontSize: '11px',
          color: '#666',
          borderTop: '1px solid #3d4250',
          marginTop: '12px'
        }}>
          Actualizando...
        </div>
      )}
    </div>
  );
};

export default PositionCard;
