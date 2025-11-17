// src/components/ProximityAlerts/useProximityAlerts.js
import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE_URL = "http://localhost:8000";
const STORAGE_KEY = "proximityAlerts";
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
  const pollIntervalRef = useRef(null);

  // Cargar alertas desde localStorage al iniciar
  useEffect(() => {
    loadAlertsFromStorage();
  }, []);

  // Iniciar polling cuando hay alertas habilitadas
  useEffect(() => {
    const enabledAlerts = alerts.filter((a) => a.enabled);

    if (enabledAlerts.length > 0) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [alerts]);

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
   * Guardar alertas en localStorage
   */
  const saveAlertsToStorage = useCallback((alertsToSave) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alertsToSave));
    } catch (error) {
      console.error("Error saving alerts to storage:", error);
    }
  }, []);

  /**
   * Agregar nueva alerta
   */
  const addAlert = useCallback(
    (alertData) => {
      setAlerts((prev) => {
        const newAlerts = [...prev, alertData];
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
  const fetchAllAlertStates = async (enabledAlerts) => {
    if (!enabledAlerts || enabledAlerts.length === 0) {
      return;
    }

    setIsPolling(true);

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
            interval: "15", // Fijo en 15min como especificaste
            targetPrice: alert.targetPrice,
            tolerancePct: alert.tolerancePct,
            volumeThresholdZScore: alert.volumeThresholdZScore,
            zScorePeriod: alert.zScorePeriod,
          })),
        }),
      });

      const data = await response.json();

      if (data.success && data.results) {
        // Actualizar estados
        const newStates = {};
        data.results.forEach((result) => {
          if (result.success) {
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

        setAlertStates((prev) => ({ ...prev, ...newStates }));
      }
    } catch (error) {
      console.error("Error fetching alert states:", error);
    } finally {
      setIsPolling(false);
    }
  };

  /**
   * Iniciar polling automático
   */
  const startPolling = () => {
    // Limpiar interval existente
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // Hacer fetch inmediato
    const enabledAlerts = alerts.filter((a) => a.enabled);
    if (enabledAlerts.length > 0) {
      fetchAllAlertStates(enabledAlerts);
    }

    // Configurar interval
    pollIntervalRef.current = setInterval(() => {
      const enabledAlerts = alerts.filter((a) => a.enabled);
      if (enabledAlerts.length > 0) {
        fetchAllAlertStates(enabledAlerts);
      }
    }, POLL_INTERVAL);
  };

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
  }, [alerts]);

  return {
    alerts,
    alertStates,
    isPolling,
    addAlert,
    updateAlert,
    deleteAlert,
    refreshAlerts,
  };
};

export default useProximityAlerts;
