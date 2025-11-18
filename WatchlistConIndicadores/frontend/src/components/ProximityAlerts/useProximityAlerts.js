// src/components/ProximityAlerts/useProximityAlerts.js
import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE_URL = "http://localhost:8000";
const STORAGE_KEY = "proximityAlerts";
const TIMEFRAME_STORAGE_KEY = "proximityAlertsTimeframe";
const POLL_INTERVAL = 90000; // 90 segundos (1.5 minutos)

/**
 * Hook para gestionar alertas de proximidad
 *
 * Funcionalidades:
 * - CRUD de alertas (create, read, update, delete)
 * - Polling automático para actualizar scores
 * - Persistencia en localStorage
 * - Cálculo de scores via API backend
 */
const useProximityAlerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [alertStates, setAlertStates] = useState({});
  const [isPolling, setIsPolling] = useState(false);
  const [timeframe, setTimeframe] = useState("15"); // "5" o "15"
  const pollIntervalRef = useRef(null);

  // Cargar alertas y timeframe desde localStorage al iniciar
  useEffect(() => {
    loadAlertsFromStorage();
    loadTimeframeFromStorage();
  }, []);

  /**
   * Cargar alertas desde localStorage
   */
  const loadAlertsFromStorage = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedAlerts = JSON.parse(stored);
        setAlerts(parsedAlerts);

        // Hacer fetch inicial de estados
        fetchAllAlertStates(parsedAlerts.filter((a) => a.enabled));
      }
    } catch (error) {
      console.error("Error loading alerts from storage:", error);
    }
  };

  /**
   * Cargar timeframe desde localStorage
   */
  const loadTimeframeFromStorage = () => {
    try {
      const stored = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
      if (stored) {
        setTimeframe(stored);
      }
    } catch (error) {
      console.error("Error loading timeframe from storage:", error);
    }
  };

  /**
   * Cambiar timeframe y guardarlo
   */
  const changeTimeframe = useCallback((newTimeframe) => {
    console.log('[useProximityAlerts] Changing timeframe from', timeframe, 'to', newTimeframe);
    setTimeframe(newTimeframe);
    localStorage.setItem(TIMEFRAME_STORAGE_KEY, newTimeframe);

    // Refrescar alertas con nuevo timeframe
    const enabledAlerts = alerts.filter((a) => a.enabled);
    if (enabledAlerts.length > 0) {
      fetchAllAlertStates(enabledAlerts);
    }
  }, [alerts, timeframe, fetchAllAlertStates]);

  /**
   * Guardar alertas en localStorage
   */
  const saveAlertsToStorage = useCallback((alertsToSave) => {
    try {
      console.log('[useProximityAlerts] Saving to localStorage:', alertsToSave);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alertsToSave));
      console.log('[useProximityAlerts] Saved successfully. Verifying...');
      const verified = localStorage.getItem(STORAGE_KEY);
      console.log('[useProximityAlerts] Verified from localStorage:', verified);
    } catch (error) {
      console.error("Error saving alerts to storage:", error);
    }
  }, []);

  /**
   * Agregar nueva alerta
   */
  const addAlert = useCallback(
    (alertData) => {
      console.log('[useProximityAlerts] Adding alert:', alertData);
      setAlerts((prev) => {
        const newAlerts = [...prev, alertData];
        console.log('[useProximityAlerts] New alerts array:', newAlerts);
        saveAlertsToStorage(newAlerts);
        return newAlerts;
      });
    },
    [saveAlertsToStorage]
  );

  /**
   * Actualizar alerta existente
   */
  const updateAlert = useCallback(
    (alertId, updates) => {
      setAlerts((prev) => {
        const newAlerts = prev.map((alert) =>
          alert.id === alertId ? { ...alert, ...updates } : alert
        );
        saveAlertsToStorage(newAlerts);
        return newAlerts;
      });
    },
    [saveAlertsToStorage]
  );

  /**
   * Eliminar alerta
   */
  const deleteAlert = useCallback(
    (alertId) => {
      setAlerts((prev) => {
        const newAlerts = prev.filter((alert) => alert.id !== alertId);
        saveAlertsToStorage(newAlerts);
        return newAlerts;
      });

      // Limpiar estado de la alerta eliminada
      setAlertStates((prev) => {
        const newStates = { ...prev };
        delete newStates[alertId];
        return newStates;
      });
    },
    [saveAlertsToStorage]
  );

  /**
   * Fetch de estados para todas las alertas habilitadas
   */
  const fetchAllAlertStates = useCallback(async (enabledAlerts) => {
    console.log('[useProximityAlerts] fetchAllAlertStates called with', enabledAlerts?.length, 'alerts');
    console.log('[useProximityAlerts] Using timeframe:', timeframe);
    if (!enabledAlerts || enabledAlerts.length === 0) {
      console.log('[useProximityAlerts] No enabled alerts, skipping fetch');
      return;
    }

    setIsPolling(true);
    console.log('[useProximityAlerts] Fetching from:', `${API_BASE_URL}/api/proximity-alerts/batch`);

    try {
      // Usar endpoint batch para mejor performance
      const response = await fetch(`${API_BASE_URL}/api/proximity-alerts/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          alerts: enabledAlerts.map((alert) => ({
            id: alert.id,
            symbol: alert.symbol,
            interval: timeframe, // Timeframe dinámico (5 o 15)
            targetPrice: alert.targetPrice,
            tolerancePct: alert.tolerancePct,
            volumeThresholdZScore: alert.volumeThresholdZScore,
            zScorePeriod: alert.zScorePeriod,
          })),
        }),
      });

      const data = await response.json();
      console.log('[useProximityAlerts] Response received:', data);

      if (data.success && data.results) {
        console.log('[useProximityAlerts] Processing', data.results.length, 'results');
        // Actualizar estados
        const newStates = {};
        data.results.forEach((result, index) => {
          console.log(`[useProximityAlerts] Result ${index}:`, result);
          if (result.success) {
            console.log('[useProximityAlerts] Alert', result.id, 'score:', result.totalScore);
            newStates[result.id] = {
              totalScore: result.totalScore,
              proximityScore: result.proximityScore,
              volumeScore: result.volumeScore,
              phase: result.phase,
              currentPrice: result.currentPrice,
              targetPrice: result.targetPrice,
              distancePct: result.distancePct,
              currentZScore: result.currentZScore,
              volumeTrend: result.volumeTrend,
              lastUpdated: result.timestamp,
            };
          }
        });

        console.log('[useProximityAlerts] Updating alert states:', newStates);
        setAlertStates((prev) => {
          const updated = { ...prev, ...newStates };
          console.log('[useProximityAlerts] New alertStates:', updated);
          return updated;
        });
      } else {
        console.log('[useProximityAlerts] Response not successful or no results');
      }
    } catch (error) {
      console.error("Error fetching alert states:", error);
    } finally {
      setIsPolling(false);
    }
  }, [timeframe]);

  /**
   * Iniciar polling automático
   */
  const startPolling = useCallback(() => {
    console.log('[useProximityAlerts] startPolling called');
    // Limpiar interval existente
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      console.log('[useProximityAlerts] Cleared existing interval');
    }

    // Hacer fetch inmediato
    const enabledAlerts = alerts.filter((a) => a.enabled);
    console.log('[useProximityAlerts] startPolling - enabled alerts:', enabledAlerts.length);
    if (enabledAlerts.length > 0) {
      console.log('[useProximityAlerts] Making immediate fetch...');
      fetchAllAlertStates(enabledAlerts);
    }

    // Configurar interval
    console.log('[useProximityAlerts] Setting up interval...');
    pollIntervalRef.current = setInterval(() => {
      console.log('[useProximityAlerts] Interval tick - fetching alerts...');
      const enabledAlerts = alerts.filter((a) => a.enabled);
      if (enabledAlerts.length > 0) {
        fetchAllAlertStates(enabledAlerts);
      }
    }, POLL_INTERVAL);
    console.log('[useProximityAlerts] Interval set with ID:', pollIntervalRef.current);
  }, [alerts, fetchAllAlertStates]);

  /**
   * Detener polling
   */
  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  /**
   * Refrescar manualmente todas las alertas
   */
  const refreshAlerts = useCallback(() => {
    const enabledAlerts = alerts.filter((a) => a.enabled);
    if (enabledAlerts.length > 0) {
      fetchAllAlertStates(enabledAlerts);
    }
  }, [alerts, fetchAllAlertStates]);

  // Iniciar polling cuando hay alertas habilitadas o cambia el timeframe
  useEffect(() => {
    const enabledAlerts = alerts.filter((a) => a.enabled);
    console.log('[useProximityAlerts] Alerts or timeframe changed:', alerts.length, 'alerts total, timeframe:', timeframe);
    console.log('[useProximityAlerts] Enabled alerts:', enabledAlerts.length);

    if (enabledAlerts.length > 0) {
      console.log('[useProximityAlerts] Starting polling...');
      startPolling();
    } else {
      console.log('[useProximityAlerts] No enabled alerts, stopping polling');
      stopPolling();
    }

    return () => stopPolling();
  }, [alerts, timeframe, startPolling]);

  return {
    alerts,
    alertStates,
    isPolling,
    timeframe,
    changeTimeframe,
    addAlert,
    updateAlert,
    deleteAlert,
    refreshAlerts,
  };
};

export default useProximityAlerts;
