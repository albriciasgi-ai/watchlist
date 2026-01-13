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

  // Exportar alertas a CSV
  const exportToCSV = useCallback(() => {
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
      'Patron',
      'Direccion',
      'Entrada',
      'StopLoss ($)',
      'StopLoss (%)',
      'TakeProfit ($)',
      'TakeProfit (%)',
      'Confianza',
      'Estado'
    ];

    // Convertir alertas a filas CSV
    const rows = alerts.map(alert => {
      const date = new Date(alert.timestamp);
      return [
        alert.symbol || '',
        date.toLocaleDateString('es-CO'),
        date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        alert.interval || '',
        alert.indicator || '',
        alert.patternType || '',
        alert.direction || '',
        alert.entry ? alert.entry.toFixed(2) : '',
        alert.stopLoss ? alert.stopLoss.toFixed(2) : '',
        alert.slPercent ? alert.slPercent.toFixed(2) : '',
        alert.takeProfit ? alert.takeProfit.toFixed(2) : '',
        alert.tpPercent ? alert.tpPercent.toFixed(2) : '',
        alert.confidence ? alert.confidence.toFixed(1) + '%' : '',
        alert.status || ''
      ];
    });

    // Construir contenido CSV
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
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
