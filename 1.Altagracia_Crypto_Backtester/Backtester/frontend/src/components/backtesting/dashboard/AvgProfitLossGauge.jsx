import React, { useState, useEffect } from 'react';
import GaugeChart from 'react-gauge-chart';

const AvgProfitLossGauge = ({ trades }) => {
  // 🎯 FIX: Control de animación - solo animar en primer render
  const [hasAnimated, setHasAnimated] = useState(false);

  // Calcular ganancia y pérdida promedio
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
    : 0;

  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
    : 0;

  // Calcular profit factor (ratio)
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 5 : 0);

  // Normalizar profit factor a 0-1 para el gauge (escala 0-5)
  const normalizedProfitFactor = Math.min(profitFactor / 5, 1);

  // 🎯 FIX: Marcar como animado solo en el primer render cuando hay datos
  useEffect(() => {
    if (!hasAnimated && trades.length > 0) {
      setHasAnimated(true);
      console.log('[AvgProfitLossGauge] Primera animación ejecutada');
    }
  }, [trades.length, hasAnimated]);

  // 🎯 FIX: Solo animar si no ha animado antes
  const shouldAnimate = !hasAnimated && trades.length > 0;

  // Determinar evaluación
  let evaluation = 'Malo';
  let evaluationColor = '#EF5350';

  if (profitFactor >= 2.0) {
    evaluation = 'Excelente';
    evaluationColor = '#4CAF50';
  } else if (profitFactor >= 1.5) {
    evaluation = 'Muy Bueno';
    evaluationColor = '#8BC34A';
  } else if (profitFactor >= 1.0) {
    evaluation = 'Bueno';
    evaluationColor = '#FFC107';
  } else if (profitFactor >= 0.5) {
    evaluation = 'Regular';
    evaluationColor = '#FF9800';
  }

  return (
    <div className="chart-card" id="avg-pnl-gauge">
      <div className="chart-header">
        <h3>Profit Factor</h3>
      </div>
      <div className="gauge-container">
        {trades.length > 0 ? (
          <>
            <GaugeChart
              id="profit-factor-gauge-chart"
              nrOfLevels={4}
              colors={['#EF5350', '#FF9800', '#FFC107', '#4CAF50']}
              arcWidth={0.3}
              percent={normalizedProfitFactor}
              textColor="#333"
              needleColor="#666"
              needleBaseColor="#666"
              hideText={true}
              animate={shouldAnimate}  // 🎯 FIX: Solo animar en primer render
              animDelay={0}
            />
            <div className="gauge-value-container">
              <div className="gauge-value" style={{ color: evaluationColor }}>
                {profitFactor.toFixed(2)}
              </div>
              <div className="gauge-label" style={{ color: evaluationColor }}>
                {evaluation}
              </div>
              <div className="gauge-subtitle">
                Ganancia Prom. / Pérdida Prom.
              </div>
            </div>
          </>
        ) : (
          <div className="no-data-message" style={{ marginTop: '60px' }}>
            No hay trades cerrados aún
          </div>
        )}
      </div>
      {trades.length > 0 && (
        <div className="chart-footer">
          <div className="stat-item">
            <span className="stat-label">Ganancia Prom.:</span>
            <span className="stat-value positive">${avgWin.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Pérdida Prom.:</span>
            <span className="stat-value negative">${avgLoss.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Ratio:</span>
            <span className={`stat-value ${profitFactor >= 1 ? 'positive' : 'negative'}`}>
              {profitFactor.toFixed(2)}x
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvgProfitLossGauge;
