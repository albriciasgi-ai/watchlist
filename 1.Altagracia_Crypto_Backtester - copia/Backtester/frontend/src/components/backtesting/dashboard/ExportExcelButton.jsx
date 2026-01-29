import React, { useState } from 'react';
import ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';

const ExportExcelButton = ({ trades, orderManager, symbol = 'Unknown' }) => {
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Formatea duración en texto
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
   * Captura un elemento HTML como imagen PNG
   */
  const captureElement = async (elementId) => {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`[ExportExcel] Elemento ${elementId} no encontrado`);
      return null;
    }

    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#FFFFFF',
        scale: 2, // Alta resolución
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });

      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error(`[ExportExcel] Error capturando ${elementId}:`, error);
      return null;
    }
  };

  /**
   * Exporta el dashboard completo a Excel
   */
  const handleExport = async () => {
    if (trades.length === 0) {
      alert('No hay trades para exportar');
      return;
    }

    setIsExporting(true);

    try {
      const workbook = new ExcelJS.Workbook();
      const metrics = orderManager.getMetrics();
      const balance = orderManager.getBalance();

      // ===== SHEET 1: TRADES =====
      const tradesSheet = workbook.addWorksheet('Trades', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
      });

      tradesSheet.columns = [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Side', key: 'side', width: 10 },
        { header: 'Entry Price', key: 'entryPrice', width: 12 },
        { header: 'Exit Price', key: 'exitPrice', width: 12 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'PnL ($)', key: 'pnl', width: 12 },
        { header: 'PnL (%)', key: 'pnlPercent', width: 12 },
        { header: 'Entry Time', key: 'entryTime', width: 20 },
        { header: 'Exit Time', key: 'exitTime', width: 20 },
        { header: 'Duration', key: 'duration', width: 12 },
        { header: 'Close Reason', key: 'closeReason', width: 15 },
        { header: 'Notes', key: 'notes', width: 30 }
      ];

      // Estilo del header
      tradesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      tradesSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2196F3' }
      };

      // Agregar datos
      trades.forEach(trade => {
        const row = tradesSheet.addRow({
          id: trade.id,
          side: trade.side.toUpperCase(),
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          pnl: trade.pnl,
          pnlPercent: trade.pnlPercent,
          entryTime: new Date(trade.entryTime).toISOString(),
          exitTime: new Date(trade.exitTime).toISOString(),
          duration: formatDuration(trade.entryTime, trade.exitTime),
          closeReason: trade.closeReason,
          notes: trade.notes || ''
        });

        // Colorear según resultado
        const pnlCell = row.getCell('pnl');
        const pnlPercentCell = row.getCell('pnlPercent');

        if (trade.pnl > 0) {
          pnlCell.font = { color: { argb: 'FF4CAF50' }, bold: true };
          pnlPercentCell.font = { color: { argb: 'FF4CAF50' }, bold: true };
        } else {
          pnlCell.font = { color: { argb: 'FFEF5350' }, bold: true };
          pnlPercentCell.font = { color: { argb: 'FFEF5350' }, bold: true };
        }
      });

      // ===== SHEET 2: MÉTRICAS =====
      const metricsSheet = workbook.addWorksheet('Métricas');

      metricsSheet.columns = [
        { header: 'Métrica', key: 'metric', width: 30 },
        { header: 'Valor', key: 'value', width: 20 }
      ];

      metricsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      metricsSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2196F3' }
      };

      const metricsData = [
        ['Balance Inicial', `$${balance.initial.toFixed(2)}`],
        ['Balance Final', `$${balance.current.toFixed(2)}`],
        ['PnL Realizado', `$${balance.realizedPnL.toFixed(2)}`],
        ['PnL No Realizado', `$${balance.unrealizedPnL.toFixed(2)}`],
        ['Total Trades', metrics.totalTrades],
        ['Trades Abiertos', metrics.openTrades],
        ['Ganadores', metrics.winningTrades],
        ['Perdedores', metrics.losingTrades],
        ['Win Rate', `${metrics.winRate.toFixed(2)}%`],
        ['Ganancia Promedio', `$${metrics.avgWin.toFixed(2)}`],
        ['Pérdida Promedio', `$${metrics.avgLoss.toFixed(2)}`],
        ['Profit Factor', metrics.profitFactor.toFixed(2)],
        ['Max Drawdown (%)', `${metrics.maxDrawdown.toFixed(2)}%`],
        ['Max Drawdown ($)', `$${metrics.maxDrawdownUSD.toFixed(2)}`],
        ['Max Growth (%)', `${metrics.maxGrowth.toFixed(2)}%`],
        ['Max Growth ($)', `$${metrics.maxGrowthUSD.toFixed(2)}`],
        ['Mayor Ganancia', `$${metrics.largestWin.toFixed(2)}`],
        ['Mayor Pérdida', `$${metrics.largestLoss.toFixed(2)}`]
      ];

      metricsData.forEach(([metric, value]) => {
        metricsSheet.addRow({ metric, value });
      });

      // ===== SHEET 3: EQUITY CURVE (IMAGEN) =====
      const equitySheet = workbook.addWorksheet('Equity Curve');

      equitySheet.addRow(['Curva de Equity']);
      equitySheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF2196F3' } };

      const equityCurveImg = await captureElement('equity-curve-chart');
      if (equityCurveImg) {
        const equityImageId = workbook.addImage({
          base64: equityCurveImg.split(',')[1],
          extension: 'png'
        });
        equitySheet.addImage(equityImageId, {
          tl: { col: 0, row: 2 },
          ext: { width: 700, height: 350 }
        });
      } else {
        equitySheet.addRow(['Gráfico no disponible']);
      }

      // ===== SHEET 4: PNL HISTOGRAM (IMAGEN) =====
      const pnlSheet = workbook.addWorksheet('PnL Histogram');

      pnlSheet.addRow(['Histograma de PnL por Trade']);
      pnlSheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF2196F3' } };

      const pnlHistogramImg = await captureElement('pnl-histogram-chart');
      if (pnlHistogramImg) {
        const pnlImageId = workbook.addImage({
          base64: pnlHistogramImg.split(',')[1],
          extension: 'png'
        });
        pnlSheet.addImage(pnlImageId, {
          tl: { col: 0, row: 2 },
          ext: { width: 700, height: 350 }
        });
      } else {
        pnlSheet.addRow(['Gráfico no disponible']);
      }

      // ===== SHEET 5: GAUGES (IMÁGENES) =====
      const gaugesSheet = workbook.addWorksheet('Gauges');

      gaugesSheet.addRow(['Win Rate & Avg PnL Gauges']);
      gaugesSheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF2196F3' } };

      // Capturar Win Rate Gauge
      const winRateGaugeImg = await captureElement('win-rate-gauge');
      if (winRateGaugeImg) {
        const winRateImageId = workbook.addImage({
          base64: winRateGaugeImg.split(',')[1],
          extension: 'png'
        });
        gaugesSheet.addImage(winRateImageId, {
          tl: { col: 0, row: 2 },
          ext: { width: 400, height: 300 }
        });
      }

      // Capturar Avg PnL Gauge
      const avgPnlGaugeImg = await captureElement('avg-pnl-gauge');
      if (avgPnlGaugeImg) {
        const avgPnlImageId = workbook.addImage({
          base64: avgPnlGaugeImg.split(',')[1],
          extension: 'png'
        });
        gaugesSheet.addImage(avgPnlImageId, {
          tl: { col: 6, row: 2 },
          ext: { width: 400, height: 300 }
        });
      }

      // ===== SHEET 6: DRAWDOWN & GROWTH (IMAGEN) =====
      const drawdownSheet = workbook.addWorksheet('Drawdown & Growth');

      drawdownSheet.addRow(['Drawdown & Growth Cards']);
      drawdownSheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF2196F3' } };

      const drawdownCardsImg = await captureElement('drawdown-growth-cards');
      if (drawdownCardsImg) {
        const drawdownImageId = workbook.addImage({
          base64: drawdownCardsImg.split(',')[1],
          extension: 'png'
        });
        drawdownSheet.addImage(drawdownImageId, {
          tl: { col: 0, row: 2 },
          ext: { width: 700, height: 250 }
        });
      } else {
        drawdownSheet.addRow(['Gráfico no disponible']);
      }

      // Guardar archivo
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backtesting_dashboard_${symbol}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[ExportExcel] Archivo exportado exitosamente');
    } catch (error) {
      console.error('[ExportExcel] Error al exportar:', error);
      alert('Error al exportar a Excel. Ver consola para detalles.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={isExporting || trades.length === 0}
      className="btn-export-excel"
      title="Exportar dashboard completo a Excel con gráficas"
    >
      {isExporting ? '⏳ Exportando...' : '📥 Exportar a Excel'}
    </button>
  );
};

export default ExportExcelButton;
