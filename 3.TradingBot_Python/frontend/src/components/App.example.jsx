/**
 * EJEMPLO DE INTEGRACIÓN DE COMPONENTES
 *
 * Este archivo muestra cómo integrar todos los componentes del Trading Bot
 * en la aplicación principal (App.jsx).
 *
 * Copiar y adaptar según necesidades.
 */

import { useState, useEffect } from 'react';
import {
  CredentialsPanel,
  DirectionManager,
  ConfigManager,
  AlertPanel,
  LogsPanel,
  PositionsPanel
} from './components';
import './App.css';

function App() {
  // Estado para los logs del sistema
  const [logs, setLogs] = useState([]);

  // Estado para la pestaña activa
  const [activeTab, setActiveTab] = useState('credentials');

  // Estado para WebSocket (opcional)
  const [wsConnected, setWsConnected] = useState(false);

  // Función helper para agregar logs
  const addLog = (level, message, details = null) => {
    const newLog = {
      timestamp: new Date().toISOString(),
      level, // 'info', 'success', 'warning', 'error'
      message,
      details
    };

    setLogs(prev => [...prev, newLog]);

    // Opcional: Limitar el número de logs en memoria
    if (logs.length > 1000) {
      setLogs(prev => prev.slice(-1000));
    }
  };

  // Función para limpiar logs
  const handleClearLogs = () => {
    setLogs([]);
    addLog('info', 'Logs cleared');
  };

  // Efecto para conectar WebSocket (opcional)
  useEffect(() => {
    // Ejemplo de conexión WebSocket para logs en tiempo real
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket('ws://localhost:5000/ws');

        ws.onopen = () => {
          setWsConnected(true);
          addLog('success', 'Connected to WebSocket');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'log') {
              addLog(data.level, data.message, data.details);
            }
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        };

        ws.onerror = (error) => {
          setWsConnected(false);
          addLog('error', 'WebSocket error', error.message);
        };

        ws.onclose = () => {
          setWsConnected(false);
          addLog('warning', 'WebSocket disconnected');

          // Intentar reconectar después de 5 segundos
          setTimeout(connectWebSocket, 5000);
        };

        return ws;
      } catch (error) {
        addLog('error', 'Failed to connect WebSocket', error.message);
      }
    };

    // Descomentar para habilitar WebSocket
    // const ws = connectWebSocket();
    // return () => ws?.close();
  }, []);

  // Log inicial
  useEffect(() => {
    addLog('info', 'Trading Bot initialized');
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>Bybit Trading Bot</h1>
        <div className="header-status">
          <span className={`status-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? '● Connected' : '● Disconnected'}
          </span>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="app-nav">
        <button
          className={`nav-tab ${activeTab === 'credentials' ? 'active' : ''}`}
          onClick={() => setActiveTab('credentials')}
        >
          Credentials
        </button>
        <button
          className={`nav-tab ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          Configuration
        </button>
        <button
          className={`nav-tab ${activeTab === 'directions' ? 'active' : ''}`}
          onClick={() => setActiveTab('directions')}
        >
          Directions
        </button>
        <button
          className={`nav-tab ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          Alerts
        </button>
        <button
          className={`nav-tab ${activeTab === 'positions' ? 'active' : ''}`}
          onClick={() => setActiveTab('positions')}
        >
          Positions
        </button>
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {/* Credentials Tab */}
        {activeTab === 'credentials' && (
          <div className="tab-content">
            <CredentialsPanel />
          </div>
        )}

        {/* Config Tab */}
        {activeTab === 'config' && (
          <div className="tab-content">
            <ConfigManager />
          </div>
        )}

        {/* Directions Tab */}
        {activeTab === 'directions' && (
          <div className="tab-content">
            <DirectionManager />
          </div>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="tab-content">
            <AlertPanel />
          </div>
        )}

        {/* Positions Tab */}
        {activeTab === 'positions' && (
          <div className="tab-content">
            <PositionsPanel />
          </div>
        )}
      </main>

      {/* Logs Panel - Always visible at bottom */}
      <aside className="app-logs">
        <LogsPanel
          logs={logs}
          maxHeight="300px"
          onClear={handleClearLogs}
        />
      </aside>

      {/* Footer */}
      <footer className="app-footer">
        <p>Bybit Trading Bot v1.0 | {logs.length} logs</p>
      </footer>
    </div>
  );
}

export default App;


/* ========================================
   ESTILOS ADICIONALES PARA App.css
   ======================================== */

/*
Agregar estos estilos a App.css:

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0f172a;
}

.app-header {
  background: #1e293b;
  padding: 20px 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #334155;
}

.app-header h1 {
  margin: 0;
  color: #f1f5f9;
  font-size: 28px;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-indicator {
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
}

.status-indicator.connected {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-indicator.disconnected {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.app-nav {
  background: #1e293b;
  padding: 0 40px;
  display: flex;
  gap: 8px;
  border-bottom: 2px solid #334155;
  overflow-x: auto;
}

.nav-tab {
  padding: 16px 24px;
  background: none;
  border: none;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.nav-tab:hover {
  color: #f1f5f9;
  background: rgba(59, 130, 246, 0.1);
}

.nav-tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.app-main {
  flex: 1;
  padding: 40px;
  overflow-y: auto;
}

.tab-content {
  max-width: 1400px;
  margin: 0 auto;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.app-logs {
  background: #1e293b;
  padding: 20px 40px;
  border-top: 2px solid #334155;
}

.app-footer {
  background: #1e293b;
  padding: 16px 40px;
  text-align: center;
  color: #64748b;
  border-top: 1px solid #334155;
  font-size: 13px;
}

.app-footer p {
  margin: 0;
}

@media (max-width: 768px) {
  .app-header {
    padding: 16px 20px;
    flex-direction: column;
    gap: 12px;
  }

  .app-header h1 {
    font-size: 24px;
  }

  .app-nav {
    padding: 0 20px;
  }

  .nav-tab {
    padding: 12px 16px;
    font-size: 13px;
  }

  .app-main {
    padding: 20px;
  }

  .app-logs {
    padding: 16px 20px;
  }

  .app-footer {
    padding: 12px 20px;
  }
}
*/
