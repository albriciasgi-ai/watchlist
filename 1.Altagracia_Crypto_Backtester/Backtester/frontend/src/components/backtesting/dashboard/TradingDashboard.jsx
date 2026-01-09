import React, { useState, useEffect } from 'react';
import EquityCurveChart from './EquityCurveChart';
import ProfitLossHistogram from './ProfitLossHistogram';
import WinRateGauge from './WinRateGauge';
import AvgProfitLossGauge from './AvgProfitLossGauge';
import DrawdownGrowthCards from './DrawdownGrowthCards';
import TradesDataGrid from './TradesDataGrid';
import ExportExcelButton from './ExportExcelButton';
import '../../../dashboard_styles.css';

const TradingDashboard = ({ orderManager, symbol }) => {
  // Estado para controlar qué trades están seleccionados
  const [selectedTradeIds, setSelectedTradeIds] = useState([]);

  // Estado para controlar el modo de visualización de gráficos
  const [equityMode, setEquityMode] = useState('percent'); // 'percent' | 'absolute'
  const [pnlHistogramMode, setPnlHistogramMode] = useState('absolute'); // 'percent' | 'absolute'

  // Estado local de métricas y trades
  const [allTrades, setAllTrades] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [balance, setBalance] = useState({});

  /**
   * 🎯 FIX: Actualizar datos desde el OrderManager usando eventos (event-driven)
   * En lugar de polling cada 2s, escuchamos evento 'tradeClosed'
   */
  useEffect(() => {
    if (!orderManager) return;

    // Carga inicial
    const initialLoad = () => {
      const closedOrders = orderManager.getClosedOrders();
      setAllTrades(closedOrders);
      setMetrics(orderManager.getMetrics());
      setBalance(orderManager.getBalance());

      console.log('[TradingDashboard] Carga inicial:', {
        trades: closedOrders.length,
        balance: orderManager.getBalance().current
      });
    };

    initialLoad();

    // 🎯 FIX: Subscribirse a evento de trade cerrado
    const handleTradeClosed = (eventData) => {
      console.log('[TradingDashboard] ✅ Evento tradeClosed recibido:', eventData);

      const closedOrders = orderManager.getClosedOrders();
      setAllTrades(closedOrders);
      setMetrics(orderManager.getMetrics());
      setBalance(orderManager.getBalance());
    };

    orderManager.on('tradeClosed', handleTradeClosed);

    // Cleanup
    return () => {
      orderManager.off('tradeClosed', handleTradeClosed);
      console.log('[TradingDashboard] Event listener removido');
    };
  }, [orderManager]);

  /**
   * Inicializar selectedTradeIds con todos los trades al inicio
   */
  useEffect(() => {
    if (allTrades.length > 0 && selectedTradeIds.length === 0) {
      setSelectedTradeIds(allTrades.map(t => t.id));
    }
  }, [allTrades]);

  /**
   * Filtrar trades según selección
   */
  const selectedTrades = allTrades.filter(t => selectedTradeIds.includes(t.id));

  /**
   * Recalcular métricas solo para trades seleccionados
   */
  const selectedMetrics = React.useMemo(() => {
    if (selectedTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        maxDrawdownUSD: 0,
        maxGrowth: 0,
        maxGrowthUSD: 0
      };
    }

    const winningTrades = selectedTrades.filter(t => t.pnl > 0);
    const losingTrades = selectedTrades.filter(t => t.pnl <= 0);

    const winRate = (winningTrades.length / selectedTrades.length) * 100;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
      : 0;

    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Calcular drawdown para trades seleccionados
    let maxDrawdown = 0;
    let maxDrawdownUSD = 0;
    let peak = balance.initial || 10000;
    let peakUSD = balance.initial || 10000;
    let currentEquity = balance.initial || 10000;

    selectedTrades.forEach(order => {
      currentEquity += order.pnl;
      if (currentEquity > peak) {
        peak = currentEquity;
        peakUSD = currentEquity;
      }
      const drawdown = ((peak - currentEquity) / peak) * 100;
      const drawdownUSD = peakUSD - currentEquity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownUSD = drawdownUSD;
      }
    });

    // Calcular growth para trades seleccionados
    let maxGrowth = 0;
    let maxGrowthUSD = 0;
    let currentGrowth = 0;
    let startBalance = balance.initial || 10000;
    let currentBalance = balance.initial || 10000;
    let inGrowthPeriod = false;

    selectedTrades.forEach(order => {
      if (order.pnl > 0) {
        if (!inGrowthPeriod) {
          startBalance = currentBalance;
          inGrowthPeriod = true;
        }
        currentGrowth += order.pnl;
        currentBalance += order.pnl;
      } else {
        if (inGrowthPeriod) {
          const growthPercent = (currentGrowth / startBalance) * 100;
          if (growthPercent > maxGrowth) {
            maxGrowth = growthPercent;
            maxGrowthUSD = currentGrowth;
          }
          currentGrowth = 0;
          inGrowthPeriod = false;
        }
        currentBalance += order.pnl;
      }
    });

    // Verificar período final
    if (inGrowthPeriod && currentGrowth > 0) {
      const growthPercent = (currentGrowth / startBalance) * 100;
      if (growthPercent > maxGrowth) {
        maxGrowth = growthPercent;
        maxGrowthUSD = currentGrowth;
      }
    }

    return {
      totalTrades: selectedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownUSD,
      maxGrowth,
      maxGrowthUSD
    };
  }, [selectedTrades, balance]);

  return (
    <div className="trading-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div className="dashboard-title">
          <h2>📊 Dashboard de Trading</h2>
          <p className="dashboard-subtitle">
            {selectedTrades.length} de {allTrades.length} trades seleccionados
          </p>
        </div>
        <div className="dashboard-actions">
          <ExportExcelButton
            trades={selectedTrades}
            orderManager={orderManager}
            symbol={symbol}
          />
        </div>
      </div>

      {allTrades.length === 0 ? (
        <div className="dashboard-empty-state">
          <div className="empty-state-icon">📊</div>
          <h3>No hay trades cerrados aún</h3>
          <p>Empieza a hacer trading para ver tus estadísticas aquí.</p>
        </div>
      ) : (
        <>
          {/* Grid de gráficos principales */}
          <div className="charts-grid">
            <div id="equity-curve-chart">
              <EquityCurveChart
                trades={selectedTrades}
                initialBalance={balance.initial || 10000}
                mode={equityMode}
                onModeChange={setEquityMode}
              />
            </div>

            <div id="pnl-histogram-chart">
              <ProfitLossHistogram
                trades={selectedTrades}
                mode={pnlHistogramMode}
                onModeChange={setPnlHistogramMode}
              />
            </div>

            <WinRateGauge trades={selectedTrades} />

            <AvgProfitLossGauge trades={selectedTrades} />
          </div>

          {/* Cards de Drawdown y Growth */}
          <div id="drawdown-growth-cards">
            <DrawdownGrowthCards metrics={selectedMetrics} />
          </div>

          {/* Tabla de trades con selección */}
          <TradesDataGrid
            trades={allTrades}
            selectedIds={selectedTradeIds}
            onSelectionChange={setSelectedTradeIds}
          />
        </>
      )}
    </div>
  );
};

export default TradingDashboard;
