import React, { useState, useEffect, useRef } from 'react';
import TimeController from './TimeController';
import BacktestingChart from './BacktestingChart';
import OrderManager from './OrderManager';
import TradingControls from './TradingControls';
import PerformancePanel from './PerformancePanel';
import TradeHistory from './TradeHistory';
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
  const [currentPrice, setCurrentPrice] = useState(null);

  // Estado de UI
  const [activePanel, setActivePanel] = useState('trading'); // 'trading', 'performance', 'history'

  // Referencias
  const timeControllerRef = useRef(null);
  const orderManagerRef = useRef(null);

  /**
   * Carga datos de backtesting desde el backend
   */
  const loadBacktestingData = async (symbolToLoad, forceRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      console.log(`[BacktestingApp] Cargando datos para ${symbolToLoad}... (force_refresh: ${forceRefresh})`);

      const url = `${API_BASE_URL}/api/backtesting/bulk-data/${symbolToLoad}${forceRefresh ? '?force_refresh=true' : ''}`;
      const response = await fetch(url);
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
   * Elimina datos de IndexedDB para un símbolo específico
   */
  const deleteFromIndexedDB = async (symbol) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('marketData')) {
          resolve();
          return;
        }

        const transaction = db.transaction(['marketData'], 'readwrite');
        const store = transaction.objectStore('marketData');
        const deleteRequest = store.delete(symbol);

        deleteRequest.onsuccess = () => {
          console.log(`[IndexedDB] Datos eliminados para ${symbol}`);
          resolve();
        };

        deleteRequest.onerror = () => reject(deleteRequest.error);
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

      // Determinar el simulationStartTime
      // Si el usuario especificó una fecha de inicio, usar esa como simulationStartTime
      // De lo contrario, usar el primer dato del historial
      let simulationStartTime;

      console.log('[BacktestingApp] DEBUG - startDate:', startDate);
      console.log('[BacktestingApp] DEBUG - firstCandle.timestamp:', firstCandle.timestamp, new Date(firstCandle.timestamp).toISOString());
      console.log('[BacktestingApp] DEBUG - lastCandle.timestamp:', lastCandle.timestamp, new Date(lastCandle.timestamp).toISOString());

      if (startDate && startDate.trim() !== '') {
        // Crear fecha en hora local del navegador (medianoche)
        const startTimestamp = new Date(startDate + 'T00:00:00').getTime();

        console.log('[BacktestingApp] DEBUG - startDate input:', startDate);
        console.log('[BacktestingApp] DEBUG - startTimestamp calculado:', startTimestamp, new Date(startTimestamp).toISOString());

        // VALIDACIÓN 1: Verificar que la fecha esté dentro del rango de datos disponibles
        const minDataBuffer = 7 * 24 * 60 * 60 * 1000; // Mínimo 7 días de datos después de la fecha
        const maxAllowedStart = lastCandle.timestamp - minDataBuffer;

        if (startTimestamp < firstCandle.timestamp) {
          setError(`❌ Fecha muy antigua. Los datos inician el ${new Date(firstCandle.timestamp).toLocaleDateString('es-CO')}. Por favor selecciona una fecha posterior.`);
          return;
        }

        if (startTimestamp > maxAllowedStart) {
          const maxDate = new Date(maxAllowedStart).toLocaleDateString('es-CO');
          const lastDate = new Date(lastCandle.timestamp).toLocaleDateString('es-CO');
          setError(`❌ Fecha muy reciente. Los datos terminan el ${lastDate}. Por favor selecciona una fecha anterior al ${maxDate} para tener suficientes datos de simulación.`);
          return;
        }

        // Buscar la primera vela que sea >= a la fecha seleccionada
        const startCandleIndex = timeframeData.main.findIndex(c => c.timestamp >= startTimestamp);

        if (startCandleIndex === -1) {
          // Este caso no debería ocurrir gracias a la validación anterior
          setError('❌ No se encontraron datos para la fecha seleccionada.');
          return;
        }

        // Verificar que haya suficientes velas después de la fecha de inicio
        const remainingCandles = timeframeData.main.length - startCandleIndex;
        const minRequiredCandles = 100; // Mínimo 100 velas para simular

        if (remainingCandles < minRequiredCandles) {
          const suggestedIndex = Math.max(0, timeframeData.main.length - minRequiredCandles - 100);
          const suggestedDate = new Date(timeframeData.main[suggestedIndex].timestamp).toLocaleDateString('es-CO');
          setError(`❌ Solo hay ${remainingCandles} velas disponibles después de esta fecha. Por favor selecciona una fecha anterior (sugerida: ${suggestedDate}).`);
          return;
        }

        // Usar la vela encontrada
        simulationStartTime = timeframeData.main[startCandleIndex].timestamp;
        console.log('[BacktestingApp] ✅ Usando fecha de inicio seleccionada:');
        console.log(`  - Fecha ingresada: ${startDate}`);
        console.log(`  - Timestamp: ${simulationStartTime}`);
        console.log(`  - Fecha real: ${new Date(simulationStartTime).toISOString()}`);
        console.log(`  - Índice de vela: ${startCandleIndex} de ${timeframeData.main.length}`);
        console.log(`  - Velas disponibles para simular: ${remainingCandles}`);
      } else {
        // Sin fecha de inicio - usar una fecha razonable por defecto
        // Buscar la vela más cercana a hace 1 año desde la última vela disponible
        const oneYearAgo = lastCandle.timestamp - (365 * 24 * 60 * 60 * 1000);
        const defaultStartIndex = timeframeData.main.findIndex(c => c.timestamp >= oneYearAgo);

        if (defaultStartIndex !== -1) {
          simulationStartTime = timeframeData.main[defaultStartIndex].timestamp;
          console.log('[BacktestingApp] Sin fecha de inicio especificada, usando hace ~1 año:', new Date(simulationStartTime).toISOString());
        } else {
          // Fallback: usar el primer dato del historial
          simulationStartTime = firstCandle.timestamp;
          console.log('[BacktestingApp] Sin fecha de inicio especificada, usando primer dato:', new Date(simulationStartTime).toISOString());
        }
      }

      // Crear TimeController
      // IMPORTANTE:
      // - startTime = firstCandle.timestamp (para mostrar TODO el historial)
      // - simulationStartTime = fecha donde empieza la simulación
      // - endTime = lastCandle.timestamp
      // - currentTime se inicializará en simulationStartTime
      const controller = new TimeController(
        firstCandle.timestamp,     // startTime: inicio del historial (para mostrar todo)
        lastCandle.timestamp,       // endTime: fin del historial
        selectedTimeframe,          // timeframe
        handleTimeUpdate,           // callback
        simulationStartTime         // simulationStartTime: donde empieza la simulación
      );

      // Inicializar sincronización multi-pestaña
      const sessionId = `${symbol}_${selectedTimeframe}_${Date.now()}`;
      controller.initSync(sessionId);

      timeControllerRef.current = controller;

      // Crear OrderManager
      if (!orderManagerRef.current) {
        orderManagerRef.current = new OrderManager(10000); // Balance inicial $10,000
        console.log('[BacktestingApp] OrderManager creado');
      }

      // El currentTime está en simulationStartTime
      setCurrentTime(controller.currentTime);

      // IMPORTANTE: Establecer precio inicial para currentTime
      // Buscar la vela que corresponde exactamente a simulationStartTime
      const startCandleIndex = timeframeData.main.findIndex(c => c.timestamp >= controller.currentTime);

      if (startCandleIndex !== -1) {
        // Usar la vela en simulationStartTime o la inmediatamente anterior
        const candleIndex = startCandleIndex > 0 ? startCandleIndex - 1 : 0;
        const startCandle = timeframeData.main[candleIndex];
        setCurrentPrice(startCandle.close);
        console.log('[BacktestingApp] ✅ Precio inicial establecido:');
        console.log(`  - Precio: ${startCandle.close}`);
        console.log(`  - Fecha de la vela: ${new Date(startCandle.timestamp).toISOString()}`);
        console.log(`  - SimulationStartTime: ${new Date(controller.currentTime).toISOString()}`);
        console.log(`  - Índice de vela: ${candleIndex} de ${timeframeData.main.length}`);
      } else {
        // Fallback: usar la última vela disponible
        const lastCandle = timeframeData.main[timeframeData.main.length - 1];
        setCurrentPrice(lastCandle.close);
        console.log('[BacktestingApp] ⚠️ Precio inicial (fallback - última vela):', lastCandle.close);
      }

      handleTimeUpdate(controller.currentTime);

      setInitialized(true);

      console.log('[BacktestingApp] ✅ Inicializado');
      console.log(`  - Mostrando historial desde: ${new Date(firstCandle.timestamp).toISOString()}`);
      console.log(`  - Simulación inicia en: ${new Date(controller.currentTime).toISOString()}`);
    }
  };

  /**
   * Callback cuando el tiempo cambia
   */
  const handleTimeUpdate = (newTime) => {
    setCurrentTime(newTime);

    // Obtener precio actual de los datos
    if (marketData && marketData.timeframes && marketData.timeframes[selectedTimeframe]) {
      const timeframeData = marketData.timeframes[selectedTimeframe];

      // Buscar la vela más reciente que no exceda currentTime
      const visibleCandles = timeframeData.main.filter(c => c.timestamp <= newTime);

      if (visibleCandles.length > 0) {
        const lastCandle = visibleCandles[visibleCandles.length - 1];
        setCurrentPrice(lastCandle.close);

        // Actualizar órdenes con el precio actual
        if (orderManagerRef.current) {
          orderManagerRef.current.updateOrders(lastCandle.close, newTime);
        }
      }
    }
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
      // Stop ya no resetea el tiempo, solo pausa
      // El currentTime se mantiene en la posición actual
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
              <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                📅 Sin fecha = inicia hace ~1 año. Los datos históricos cubren ~3 años de información.
              </small>
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
          {marketData && marketData.metadata && (
            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
              📅 Datos: {new Date(marketData.metadata.date_range.start).toLocaleDateString('es-CO')} - {new Date(marketData.metadata.date_range.end).toLocaleDateString('es-CO')}
              <button
                onClick={async () => {
                  const confirmed = window.confirm('¿Actualizar datos históricos desde Bybit? Esto puede tardar 30-60 segundos y eliminará todos los cachés.');
                  if (confirmed) {
                    try {
                      setLoading(true);
                      setError(null);

                      console.log('[BacktestingApp] ====== INICIANDO ACTUALIZACIÓN COMPLETA ======');

                      // 1. Eliminar caché del backend
                      console.log('[BacktestingApp] Paso 1/4: Eliminando caché del backend...');
                      const deleteResponse = await fetch(`${API_BASE_URL}/api/backtesting/cache/${symbol}`, {
                        method: 'DELETE'
                      });
                      const deleteResult = await deleteResponse.json();
                      console.log('[BacktestingApp] Backend caché eliminado:', deleteResult);

                      // 2. Eliminar datos de IndexedDB
                      console.log('[BacktestingApp] Paso 2/4: Eliminando caché de IndexedDB...');
                      await deleteFromIndexedDB(symbol);

                      // 3. Limpiar localStorage también
                      console.log('[BacktestingApp] Paso 3/4: Limpiando localStorage...');
                      localStorage.removeItem(`backtesting_${symbol}`);

                      // 4. Descargar datos frescos desde Bybit con force_refresh
                      console.log('[BacktestingApp] Paso 4/4: Descargando datos frescos desde Bybit...');
                      const freshData = await loadBacktestingData(symbol, true);

                      if (freshData && freshData.metadata) {
                        console.log('[BacktestingApp] ✅ DATOS ACTUALIZADOS:');
                        console.log(`  - Inicio: ${freshData.metadata.date_range.start}`);
                        console.log(`  - Fin: ${freshData.metadata.date_range.end}`);
                        console.log(`  - Cached at: ${freshData.metadata.cached_at_colombia}`);
                      }

                      // 5. Recargar página para aplicar cambios
                      console.log('[BacktestingApp] Recargando página en 2 segundos...');
                      setTimeout(() => {
                        window.location.reload();
                      }, 2000);
                    } catch (err) {
                      console.error('[BacktestingApp] ❌ Error al actualizar:', err);
                      setError('Error al actualizar datos: ' + err.message);
                      setLoading(false);
                    }
                  }
                }}
                style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
                title="Descargar datos actualizados desde Bybit"
              >
                🔄 Actualizar
              </button>
            </div>
          )}
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
          {currentPrice && (
            <div className="current-price">
              Precio: ${currentPrice.toFixed(2)}
            </div>
          )}
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
              <option value="20">20x</option>
              <option value="40">40x</option>
              <option value="60">60x</option>
              <option value="80">80x</option>
              <option value="100">100x</option>
              <option value="200">200x</option>
              <option value="300">300x</option>
              <option value="400">400x</option>
              <option value="500">500x</option>
              <option value="600">600x</option>
              <option value="700">700x</option>
              <option value="800">800x</option>
              <option value="900">900x</option>
              <option value="1000">1000x</option>
              <option value="2000">2000x</option>
              <option value="3000">3000x</option>
              <option value="4000">4000x</option>
              <option value="5000">5000x</option>
              <option value="6000">6000x</option>
              <option value="7000">7000x</option>
              <option value="8000">8000x</option>
              <option value="9000">9000x</option>
              <option value="10000">10000x</option>
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

      <div className="backtesting-main-wrapper">
        <div className="backtesting-main">
          <BacktestingChart
            symbol={symbol}
            timeframe={selectedTimeframe}
            marketData={marketData}
            currentTime={currentTime}
            isPlaying={isPlaying}
            timeController={timeControllerRef.current}
            orderManager={orderManagerRef.current}
          />
        </div>

        <div className="backtesting-sidebar">
          {/* Panel Tabs */}
          <div className="sidebar-tabs">
            <button
              className={`tab-btn ${activePanel === 'trading' ? 'active' : ''}`}
              onClick={() => setActivePanel('trading')}
            >
              📊 Trading
            </button>
            <button
              className={`tab-btn ${activePanel === 'performance' ? 'active' : ''}`}
              onClick={() => setActivePanel('performance')}
            >
              📈 Métricas
            </button>
            <button
              className={`tab-btn ${activePanel === 'history' ? 'active' : ''}`}
              onClick={() => setActivePanel('history')}
            >
              📋 Historial
            </button>
          </div>

          {/* Panel Content */}
          <div className="sidebar-content">
            {activePanel === 'trading' && (
              <TradingControls
                orderManager={orderManagerRef.current}
                currentPrice={currentPrice}
                currentTime={currentTime}
                onOrderCreated={() => console.log('[BacktestingApp] Orden creada')}
              />
            )}

            {activePanel === 'performance' && (
              <PerformancePanel
                orderManager={orderManagerRef.current}
                currentPrice={currentPrice}
                currentTime={currentTime}
              />
            )}

            {activePanel === 'history' && (
              <TradeHistory orderManager={orderManagerRef.current} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BacktestingApp;
