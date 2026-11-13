import React, { useState, useEffect } from 'react';
import GaugeChart from 'react-gauge-chart';
import useUiTheme from '../../useUiTheme.js';
import { dashboardPalette } from './dashboardPalette.js';

// themed (13/11/2026, el journal de la suite): zonas, aguja y textos con los colores del estilo elegido.
// App 1 no lo pasa y lo ve como siempre
const WinRateGauge = ({ trades, themed = false }) => {
  useUiTheme(); // Con themed, vuelve a pintar al cambiar el estilo
  const palette = dashboardPalette(themed);

  // 🎯 FIX: Control de animación - solo animar en primer render
  const [hasAnimated, setHasAnimated] = useState(false);

  // Calcular win rate
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  // Normalizar win rate a 0-1 para el gauge
  const normalizedWinRate = winRate / 100;

  // 🎯 FIX: Marcar como animado solo en el primer render cuando hay datos
  useEffect(() => {
    if (!hasAnimated && totalTrades > 0) {
      setHasAnimated(true);
      console.log('[WinRateGauge] Primera animación ejecutada');
    }
  }, [totalTrades, hasAnimated]);

  // 🎯 FIX: Solo animar si no ha animado antes
  const shouldAnimate = !hasAnimated && totalTrades > 0;

  // Determinar zona de color
  let zoneLabel = 'Malo';
  let zoneColor = palette.zoneText.bad;

  if (winRate >= 60) {
    zoneLabel = 'Excelente';
    zoneColor = palette.zoneText.great;
  } else if (winRate >= 50) {
    zoneLabel = 'Bueno';
    zoneColor = palette.zoneText.good;
  } else if (winRate >= 40) {
    zoneLabel = 'Regular';
    zoneColor = palette.zoneText.fair;
  }

  return (
    <div className="chart-card" id="win-rate-gauge">
      <div className="chart-header">
        <h3>Win Rate</h3>
      </div>
      <div className="gauge-container">
        {totalTrades > 0 ? (
          <>
            <GaugeChart
              id="win-rate-gauge-chart"
              nrOfLevels={3}
              colors={[palette.zone.bad, palette.zone.fair, palette.zone.great]}
              arcWidth={0.3}
              percent={normalizedWinRate}
              textColor={palette.gaugeText}
              needleColor={palette.needle}
              needleBaseColor={palette.needle}
              hideText={true}
              animate={shouldAnimate}  // 🎯 FIX: Solo animar en primer render
              animDelay={0}
            />
            <div className="gauge-value-container">
              <div className="gauge-value" style={{ color: zoneColor }}>
                {winRate.toFixed(1)}%
              </div>
              <div className="gauge-label" style={{ color: zoneColor }}>
                {zoneLabel}
              </div>
            </div>
          </>
        ) : (
          <div className="no-data-message" style={{ marginTop: '60px' }}>
            No hay trades cerrados aún
          </div>
        )}
      </div>
      {totalTrades > 0 && (
        <div className="chart-footer">
          <div className="stat-item">
            <span className="stat-label">Ganadores:</span>
            <span className="stat-value positive">{winningTrades}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Perdedores:</span>
            <span className="stat-value negative">{totalTrades - winningTrades}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total:</span>
            <span className="stat-value">{totalTrades}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
export default React.memo(WinRateGauge);
