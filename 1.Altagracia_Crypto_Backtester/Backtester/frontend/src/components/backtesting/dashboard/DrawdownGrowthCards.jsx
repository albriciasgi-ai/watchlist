import React from 'react';

const DrawdownGrowthCards = ({ metrics }) => {
  const {
    maxDrawdown = 0,
    maxDrawdownUSD = 0,
    maxGrowth = 0,
    maxGrowthUSD = 0
  } = metrics || {};

  return (
    <div className="chart-card drawdown-growth-cards">
      <div className="chart-header">
        <h3>Riesgo y Recompensa</h3>
      </div>
      <div className="cards-container">
        {/* Max Drawdown Card */}
        <div className="metric-card drawdown-card">
          <div className="metric-icon negative">
            📉
          </div>
          <div className="metric-content">
            <div className="metric-title">Max Drawdown</div>
            <div className="metric-main-value negative">
              {maxDrawdown.toFixed(2)}%
            </div>
            <div className="metric-sub-value negative">
              ${maxDrawdownUSD.toFixed(2)}
            </div>
            <div className="metric-description">
              Máxima pérdida consecutiva desde un pico
            </div>
          </div>
        </div>

        {/* Max Growth Card */}
        <div className="metric-card growth-card">
          <div className="metric-icon positive">
            📈
          </div>
          <div className="metric-content">
            <div className="metric-title">Max Growth</div>
            <div className="metric-main-value positive">
              {maxGrowth.toFixed(2)}%
            </div>
            <div className="metric-sub-value positive">
              ${maxGrowthUSD.toFixed(2)}
            </div>
            <div className="metric-description">
              Máxima ganancia consecutiva
            </div>
          </div>
        </div>

        {/* Ratio Card */}
        <div className="metric-card ratio-card">
          <div className="metric-icon neutral">
            ⚖️
          </div>
          <div className="metric-content">
            <div className="metric-title">Ratio Growth/Drawdown</div>
            <div className="metric-main-value neutral">
              {maxDrawdown > 0
                ? (maxGrowth / maxDrawdown).toFixed(2)
                : (maxGrowth > 0 ? '∞' : '0')
              }x
            </div>
            <div className="metric-sub-value neutral">
              {maxDrawdown > 0 && maxGrowth > maxDrawdown && '✓ Recompensa > Riesgo'}
              {maxDrawdown > 0 && maxGrowth <= maxDrawdown && '⚠ Riesgo > Recompensa'}
              {maxDrawdown === 0 && maxGrowth > 0 && '✓ Sin Drawdown'}
              {maxDrawdown === 0 && maxGrowth === 0 && 'Sin datos suficientes'}
            </div>
            <div className="metric-description">
              Relación entre máximo crecimiento y máximo drawdown
            </div>
          </div>
        </div>
      </div>

      {/* Footer con interpretación */}
      {maxDrawdown > 0 && (
        <div className="chart-footer interpretation">
          <div className="interpretation-text">
            <strong>Interpretación:</strong> {' '}
            {maxGrowth > maxDrawdown * 1.5 && (
              'Excelente. Tu estrategia genera más recompensa que riesgo. El crecimiento máximo supera significativamente el drawdown máximo.'
            )}
            {maxGrowth > maxDrawdown && maxGrowth <= maxDrawdown * 1.5 && (
              'Bueno. La estrategia es rentable, con recompensa ligeramente mayor al riesgo.'
            )}
            {maxGrowth === maxDrawdown && (
              'Neutral. Recompensa y riesgo están equilibrados. Considera optimizar para mejorar el ratio.'
            )}
            {maxGrowth < maxDrawdown && maxGrowth > 0 && (
              'Precaución. El riesgo (drawdown) supera la recompensa. Evalúa ajustar tu estrategia o gestión de riesgo.'
            )}
            {maxGrowth === 0 && (
              'Sin crecimiento consecutivo registrado. Todos los períodos de ganancia han sido interrumpidos.'
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
export default React.memo(DrawdownGrowthCards);
