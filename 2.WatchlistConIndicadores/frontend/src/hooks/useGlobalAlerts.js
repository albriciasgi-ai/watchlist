import { useState, useEffect, useCallback } from 'react';

const GLOBAL_KEY = 'watchlist_global_alert_history';
const REFRESH_INTERVAL = 3000; // 3 segundos

/**
 * Hook para manejar el historial global de alertas
 * Usado por el panel deslizante de alertas
 */
export function useGlobalAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Cargar alertas desde localStorage
  const loadAlerts = useCallback(() => {
    try {
      const stored = localStorage.getItem(GLOBAL_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      setAlerts(parsed);
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading global alerts:', error);
      setAlerts([]);
      setIsLoading(false);
    }
  }, []);

  // Limpiar todas las alertas
  const clearAlerts = useCallback(() => {
    try {
      localStorage.removeItem(GLOBAL_KEY);
      setAlerts([]);
    } catch (error) {
      console.error('Error clearing alerts:', error);
    }
  }, []);

  // Eliminar una alerta específica
  const removeAlert = useCallback((alertId) => {
    try {
      const filtered = alerts.filter(a => a.id !== alertId);
      localStorage.setItem(GLOBAL_KEY, JSON.stringify(filtered));
      setAlerts(filtered);
    } catch (error) {
      console.error('Error removing alert:', error);
    }
  }, [alerts]);

  // Formatear número con coma como separador decimal (formato español/europeo)
  const formatNumberForCSV = (value, decimals = 2) => {
    if (value === null || value === undefined || isNaN(value)) return '';
    return value.toFixed(decimals).replace('.', ',');
  };

  // Calcular P/L para una alerta
  const calculatePL = (alert, riskAmount) => {
    if (!alert.outcome || alert.outcome === 'PENDING') {
      return { plPercent: null, plUSDT: null };
    }

    const slPercent = Math.abs(alert.slPercent || 0);
    const tpPercent = Math.abs(alert.tpPercent || 0);
    const rr = slPercent > 0 ? tpPercent / slPercent : 0;

    if (alert.outcome === 'WIN') {
      return { plPercent: tpPercent, plUSDT: riskAmount * rr };
    } else if (alert.outcome === 'LOSS') {
      return { plPercent: -slPercent, plUSDT: -riskAmount };
    }

    return { plPercent: null, plUSDT: null };
  };

  // Exportar alertas a CSV (formato español: separador de campos = ;, decimal = ,)
  const exportToCSV = useCallback((riskAmount = 100) => {
    if (alerts.length === 0) {
      alert('No hay alertas para exportar');
      return;
    }

    // Headers del CSV
    const headers = [
      'Moneda',
      'Fecha',
      'Hora',
      'Timeframe',
      'Indicador',
      'Direccion',
      'Entrada',
      'StopLoss ($)',
      'StopLoss (%)',
      'TakeProfit ($)',
      'TakeProfit (%)',
      'Resultado',
      'P/L (%)',
      'P/L ($)'
    ];

    // Calcular totales
    let totalWins = 0;
    let totalLosses = 0;
    let totalPLPercent = 0;
    let totalPLUSDT = 0;

    // Convertir alertas a filas CSV
    const rows = alerts.map(alertItem => {
      const date = new Date(alertItem.timestamp);
      const { plPercent, plUSDT } = calculatePL(alertItem, riskAmount);

      // Acumular totales
      if (alertItem.outcome === 'WIN') totalWins++;
      if (alertItem.outcome === 'LOSS') totalLosses++;
      if (plPercent !== null) totalPLPercent += plPercent;
      if (plUSDT !== null) totalPLUSDT += plUSDT;

      return [
        alertItem.symbol || '',
        date.toLocaleDateString('es-CO'),
        date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        alertItem.interval || '',
        alertItem.indicator || '',
        alertItem.direction || '',
        formatNumberForCSV(alertItem.entry),
        formatNumberForCSV(alertItem.stopLoss),
        formatNumberForCSV(alertItem.slPercent),
        formatNumberForCSV(alertItem.takeProfit),
        formatNumberForCSV(alertItem.tpPercent),
        alertItem.outcome || 'PENDING',
        plPercent !== null ? formatNumberForCSV(plPercent) : '',
        plUSDT !== null ? formatNumberForCSV(plUSDT) : ''
      ];
    });

    // Fila de totales
    const completedTrades = totalWins + totalLosses;
    const winRate = completedTrades > 0 ? (totalWins / completedTrades * 100).toFixed(1) : '0';
    const summaryRow = [
      'TOTAL',
      `${completedTrades} trades`,
      `${totalWins}W / ${totalLosses}L`,
      `WR: ${winRate}%`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totalPLUSDT >= 0 ? 'PROFIT' : 'LOSS',
      formatNumberForCSV(totalPLPercent),
      formatNumberForCSV(totalPLUSDT)
    ];

    // Construir contenido CSV con separador de campos semicolon (;) para Excel español
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';')),
      '', // Línea vacía antes del total
      summaryRow.map(cell => `"${cell}"`).join(';')
    ].join('\n');

    // Crear y descargar archivo
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `alertas_watchlist_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [alerts]);

  // Cargar al montar y auto-refresh
  useEffect(() => {
    loadAlerts();

    // Auto-refresh periódico
    const interval = setInterval(loadAlerts, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [loadAlerts]);

  // Escuchar cambios en localStorage desde otras pestañas/ventanas
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === GLOBAL_KEY) {
        loadAlerts();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [loadAlerts]);

  return {
    alerts,
    isLoading,
    loadAlerts,
    clearAlerts,
    removeAlert,
    exportToCSV,
    alertCount: alerts.length
  };
}

export default useGlobalAlerts;
