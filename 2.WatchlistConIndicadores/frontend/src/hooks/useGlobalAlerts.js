import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config';

const GLOBAL_KEY = 'watchlist_global_alert_history';
const REFRESH_INTERVAL = 3000; // 3 segundos
const EVALUATION_INTERVAL = 10000; // 10 segundos para evaluar outcomes

/**
 * Hook para manejar el historial global de alertas
 * Usado por el panel deslizante de alertas
 */
export function useGlobalAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const evaluationInProgress = useRef(false);

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

  /**
   * Evalúa el resultado de una alerta PENDING usando datos históricos de velas
   */
  const evaluateAlertOutcome = async (alert, candles) => {
    if (!alert.entry || !alert.stopLoss || !alert.takeProfit) {
      return alert;
    }

    const alertTime = alert.timestamp;
    const sl = alert.stopLoss;
    const tp = alert.takeProfit;
    const direction = alert.direction;

    // Helper para obtener timestamp normalizado
    const getCandleTime = (candle) => {
      const t = candle.timestamp || candle.time || candle.openTime || candle.start;
      return t < 1000000000000 ? t * 1000 : t;
    };

    // Filtrar y ordenar velas posteriores a la alerta
    const candlesAfterAlert = candles
      .filter(c => getCandleTime(c) > alertTime)
      .sort((a, b) => getCandleTime(a) - getCandleTime(b));

    if (candlesAfterAlert.length === 0) {
      return alert;
    }

    // Evaluar cada vela
    for (const candle of candlesAfterAlert) {
      const high = parseFloat(candle.high);
      const low = parseFloat(candle.low);

      if (direction === 'LONG') {
        if (low <= sl) {
          return { ...alert, outcome: 'LOSS', outcomeTimestamp: getCandleTime(candle) };
        }
        if (high >= tp) {
          return { ...alert, outcome: 'WIN', outcomeTimestamp: getCandleTime(candle) };
        }
      } else if (direction === 'SHORT') {
        if (high >= sl) {
          return { ...alert, outcome: 'LOSS', outcomeTimestamp: getCandleTime(candle) };
        }
        if (low <= tp) {
          return { ...alert, outcome: 'WIN', outcomeTimestamp: getCandleTime(candle) };
        }
      }
    }

    return alert;
  };

  /**
   * Evalúa todos los trades PENDING consultando datos históricos del API
   */
  const evaluatePendingOutcomes = useCallback(async () => {
    // Evitar evaluaciones simultáneas
    if (evaluationInProgress.current) return;

    try {
      const stored = localStorage.getItem(GLOBAL_KEY);
      if (!stored) return;

      const currentAlerts = JSON.parse(stored);
      const pendingAlerts = currentAlerts.filter(a => a.outcome === 'PENDING' && a.entry && a.stopLoss && a.takeProfit);

      if (pendingAlerts.length === 0) return;

      evaluationInProgress.current = true;
      setIsEvaluating(true);

      // Agrupar alertas por symbol+interval para minimizar requests
      const groups = {};
      pendingAlerts.forEach(alert => {
        const key = `${alert.symbol}_${alert.interval}`;
        if (!groups[key]) {
          groups[key] = {
            symbol: alert.symbol,
            interval: alert.interval,
            alerts: []
          };
        }
        groups[key].alerts.push(alert);
      });

      let updated = false;
      const updatedAlerts = [...currentAlerts];

      // Procesar cada grupo
      for (const key of Object.keys(groups)) {
        const group = groups[key];

        try {
          // Fetch datos históricos (últimos 7 días debería ser suficiente)
          const response = await fetch(
            `${API_BASE_URL}/api/historical/${group.symbol}?interval=${group.interval}&days=7`
          );

          if (!response.ok) {
            console.warn(`Failed to fetch candles for ${group.symbol}:`, response.status);
            continue;
          }

          const data = await response.json();
          const candles = data.success ? (data.data || data.candles || []) : [];

          if (candles.length === 0) {
            console.warn(`No candles returned for ${group.symbol}`);
            continue;
          }

          // Evaluar cada alerta del grupo
          for (const pendingAlert of group.alerts) {
            const evaluatedAlert = await evaluateAlertOutcome(pendingAlert, candles);

            if (evaluatedAlert.outcome !== 'PENDING') {
              // Actualizar en el array
              const idx = updatedAlerts.findIndex(a => a.id === pendingAlert.id);
              if (idx !== -1) {
                updatedAlerts[idx] = evaluatedAlert;
                updated = true;
                console.log(`📊 Trade ${evaluatedAlert.outcome}: ${pendingAlert.symbol} ${pendingAlert.patternType}`);
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching candles for ${group.symbol}:`, error);
        }
      }

      // Guardar si hubo cambios
      if (updated) {
        localStorage.setItem(GLOBAL_KEY, JSON.stringify(updatedAlerts));
        setAlerts(updatedAlerts);
        console.log('✅ Trade outcomes updated');
      }
    } catch (error) {
      console.error('Error evaluating pending outcomes:', error);
    } finally {
      evaluationInProgress.current = false;
      setIsEvaluating(false);
    }
  }, []);

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

  // Evaluar outcomes periódicamente
  useEffect(() => {
    // Evaluar inmediatamente al cargar
    evaluatePendingOutcomes();

    // Evaluar periódicamente
    const interval = setInterval(evaluatePendingOutcomes, EVALUATION_INTERVAL);

    return () => clearInterval(interval);
  }, [evaluatePendingOutcomes]);

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
    isEvaluating,
    loadAlerts,
    clearAlerts,
    removeAlert,
    exportToCSV,
    evaluatePendingOutcomes,
    alertCount: alerts.length
  };
}

export default useGlobalAlerts;
