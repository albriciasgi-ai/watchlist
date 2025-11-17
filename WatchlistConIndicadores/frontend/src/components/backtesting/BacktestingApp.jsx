import React, { useState, useEffect, useRef } from 'react';
import TimeController from './TimeController';
import BacktestingChart from './BacktestingChart';
import { API_BASE_URL } from '../../config';
import '../../backtesting_styles.css';

const BacktestingApp = () => {
  // Estado principal
  const [symbol, setSymbol] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState('15m');
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // Estado de reproducción
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [startDate, setStartDate] = useState('');

  // Referencias
  const timeControllerRef = useRef(null);

  /**
   * Carga datos de backtesting desde el backend
   */
  const loadBacktestingData = async (symbolToLoad) => {
    setLoading(true);
    setError(null);

    try {
      console.log(`[BacktestingApp] Cargando datos para ${symbolToLoad}...`);

      const response = await fetch(`${API_BASE_URL}/api/backtesting/bulk-data/${symbolToLoad}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Error al cargar datos');
      }

      console.log('[BacktestingApp] Datos cargados:', data);
      setMarketData(data);

      // Guardar en IndexedDB para futuras sesiones
      await saveToIndexedDB(symbolToLoad, data);

      return data;

    } catch (err) {
      console.error('[BacktestingApp] Error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Guarda datos en IndexedDB
   */
  const saveToIndexedDB = async (symbol, data) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['marketData'], 'readwrite');
        const store = transaction.objectStore('marketData');

        const saveRequest = store.put({
          symbol: symbol,
          data: data,
          savedAt: Date.now()
        });

        saveRequest.onsuccess = () => {
          console.log(`[IndexedDB] Datos guardados para ${symbol}`);
          resolve();
        };

        saveRequest.onerror = () => reject(saveRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('marketData')) {
          const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  };

  /**
   * Carga datos desde IndexedDB
   */
  const loadFromIndexedDB = async (symbol) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('marketData')) {
          resolve(null);
          return;
        }

        const transaction = db.transaction(['marketData'], 'readonly');
        const store = transaction.objectStore('marketData');
        const getRequest = store.get(symbol);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            console.log(`[IndexedDB] Datos cargados para ${symbol}`);
            resolve(getRequest.result.data);
          } else {
            resolve(null);
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('marketData')) {
          const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  };

  /**
   * Inicializa el backtesting con un símbolo
   */
  const handleInitialize = async () => {
    if (!symbol) {
      setError('Por favor ingresa un símbolo');
      return;
    }

    // Intentar cargar desde IndexedDB primero
    const cachedData = await loadFromIndexedDB(symbol);

    let data;
    if (cachedData) {
      console.log('[BacktestingApp] Usando datos de IndexedDB');
      setMarketData(cachedData);
      data = cachedData;
    } else {
      console.log('[BacktestingApp] Descargando datos del servidor...');
      data = await loadBacktestingData(symbol);
    }

    if (data && data.timeframes && data.timeframes[selectedTimeframe]) {
      const timeframeData = data.timeframes[selectedTimeframe];
      const firstCandle = timeframeData.main[0];
      const lastCandle = timeframeData.main[timeframeData.main.length - 1];

      // Crear TimeController
      const controller = new TimeController(
        firstCandle.timestamp,
        lastCandle.timestamp,
        selectedTimeframe,
        handleTimeUpdate
      );

      // Inicializar sincronización multi-pestaña
      const sessionId = `${symbol}_${selectedTimeframe}_${Date.now()}`;
      controller.initSync(sessionId);

      timeControllerRef.current = controller;

      // Si se especificó una fecha de inicio, saltar a ella
      if (startDate) {
        const startTimestamp = new Date(startDate).getTime();
        controller.jumpTo(startTimestamp);
      }

      setCurrentTime(controller.currentTime);
      setInitialized(true);

      console.log('[BacktestingApp] ✅ Inicializado');
    }
  };

  /**
   * Callback cuando el tiempo cambia
   */
  const handleTimeUpdate = (newTime) => {
    setCurrentTime(newTime);
  };

  /**
   * Controles de reproducción
   */
  const handlePlay = () => {
    console.log('[BacktestingApp] handlePlay clicked', {
      hasController: !!timeControllerRef.current,
      currentTime,
      isPlaying
    });
    if (timeControllerRef.current) {
      timeControllerRef.current.play();
      setIsPlaying(true);
    } else {
      console.error('[BacktestingApp] No hay timeController');
    }
  };

  const handlePause = () => {
    console.log('[BacktestingApp] handlePause clicked');
    if (timeControllerRef.current) {
      timeControllerRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    console.log('[BacktestingApp] handleStop clicked');
    if (timeControllerRef.current) {
      timeControllerRef.current.stop();
      setIsPlaying(false);
      setCurrentTime(timeControllerRef.current.currentTime);
    }
  };

  const handleSpeedChange = (speed) => {
    if (timeControllerRef.current) {
      timeControllerRef.current.setSpeed(speed);
      setPlaybackSpeed(speed);
    }
  };

  /**
   * Cleanup al desmontar
   */
  useEffect(() => {
    return () => {
      if (timeControllerRef.current) {
        timeControllerRef.current.destroy();
      }
    };
  }, []);

  /**
   * Renderizar vista de configuración inicial
   */
  if (!initialized) {
    return (
      <div className="backtesting-container">
        <div className="backtesting-setup">
          <h1>Backtesting Engine</h1>
          <p className="subtitle">Simula operaciones con datos históricos del mercado</p>

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          <div className="setup-form">
            <div className="form-group">
              <label>Símbolo</label>
              <input
                type="text"
                placeholder="BTCUSDT"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Timeframe</label>
              <select
                value={selectedTimeframe}
                onChange={(e) => setSelectedTimeframe(e.target.value)}
                disabled={loading}
              >
                <option value="15m">15 minutos</option>
                <option value="1h">1 hora</option>
                <option value="4h">4 horas</option>
              </select>
            </div>

            <div className="form-group">
              <label>Fecha de Inicio (opcional)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleInitialize}
              disabled={loading || !symbol}
            >
              {loading ? 'Cargando datos...' : 'Inicializar Backtesting'}
            </button>

            {loading && (
              <div className="loading-indicator">
                <div className="spinner"></div>
                <p>Descargando 3 años de datos históricos...</p>
                <p className="small-text">Esto puede tomar 30-60 segundos</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /**
   * Renderizar vista principal de backtesting
   */
  return (
    <div className="backtesting-container">
      <div className="backtesting-header">
        <div className="header-info">
          <h2>{symbol} - {selectedTimeframe}</h2>
          <div className="current-time">
            {currentTime && new Date(currentTime).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>

        <div className="playback-controls">
          <button
            className={`btn-control ${isPlaying ? 'active' : ''}`}
            onClick={isPlaying ? handlePause : handlePlay}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>

          <button
            className="btn-control"
            onClick={handleStop}
            title="Detener"
          >
            ⏹️
          </button>

          <div className="speed-control">
            <label>Velocidad:</label>
            <select
              value={playbackSpeed}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
              <option value="20">20x</option>
            </select>
          </div>

          <button
            className="btn-secondary"
            onClick={() => setInitialized(false)}
            title="Cambiar configuración"
          >
            ⚙️ Configurar
          </button>
        </div>
      </div>

      <div className="backtesting-main">
        <BacktestingChart
          symbol={symbol}
          timeframe={selectedTimeframe}
          marketData={marketData}
          currentTime={currentTime}
          timeController={timeControllerRef.current}
        />
      </div>
    </div>
  );
};

export default BacktestingApp;
