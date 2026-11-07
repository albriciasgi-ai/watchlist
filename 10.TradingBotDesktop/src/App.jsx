import { useState, useEffect } from 'react'
import { Activity, Settings, TrendingUp, AlertCircle, FileText, Shield } from 'lucide-react'
import './App.css'
import { WS_URL, API_BASE_URL } from './config'
import CredentialsPanel from './components/CredentialsPanel'
import DirectionManager from './components/DirectionManager'
import AlertOriginsPanel from './components/AlertOriginsPanel'
import ConfigManager from './components/ConfigManager'
import AlertPanel from './components/AlertPanel'
import LogsPanel from './components/LogsPanel'
import PositionsPanel from './components/PositionsPanel'
import OrdersPanel from './components/OrdersPanel'
import RiskManagementModal from './components/RiskManagementModal'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isConnected, setIsConnected] = useState(false)
  const [logs, setLogs] = useState([])
  const [ws, setWs] = useState(null)
  const [showRiskModal, setShowRiskModal] = useState(false)
  const [stats, setStats] = useState({
    credentialsConfigured: false,
    symbolsConfigured: 0,
    activeConnections: 0
  })

  // Detectar si estamos en Electron
  const isElectron = window.electronAPI?.isElectron || false

  // Aviso del sistema operativo (no cambia la ventana)
  const notify = (title, body) => {
    try {
      if (window.electronAPI?.showNotification) {
        window.electronAPI.showNotification(title, body)
      } else if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { body })
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification(title, { body })
          })
        }
      }
    } catch (error) {
      console.error('Notification error:', error)
    }
  }

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const websocket = new WebSocket(WS_URL)

      websocket.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
        // Recupera los logs que se perdieron mientras no habia conexion
        fetch(`${API_BASE_URL}/api/logs?limit=1000`)
          .then(r => r.json())
          .then(data => {
            if (!Array.isArray(data.logs)) return
            setLogs(prev => {
              const seen = new Set(data.logs.map(l => `${l.timestamp}|${l.message}`))
              return [...data.logs, ...prev.filter(l => !seen.has(`${l.timestamp}|${l.message}`))].slice(-1000)
            })
          })
          .catch(() => {})
      }

      websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'log') {
            setLogs(prev => [...prev, message.data].slice(-1000))
          } else if (message.type === 'critical_alert') {
            // Ej: "Position is UNPROTECTED!" o posicion cerrada por no poder poner el SL
            const alert = message.data || {}
            notify(`ALERTA CRITICA ${alert.symbol || ''}`.trim(), alert.message || alert.type || 'Revisa el bot')
          } else if (message.type === 'daily_limit_reached') {
            const info = message.data || {}
            notify('Limite diario alcanzado',
              `${info.symbol || ''} ${info.side || ''}: usado $${Number(info.used || 0).toFixed(2)} de $${Number(info.limit || 0).toFixed(2)}`)
          } else if (message.type === 'trading_paused') {
            notify('Trading Bot', message.data?.paused ? 'Bot en pausa: no abrira operaciones' : 'Bot reanudado')
          }
        } catch (error) {
          console.error('WebSocket message error:', error)
        }
      }

      websocket.onclose = () => {
        console.log('WebSocket disconnected')
        setIsConnected(false)
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      setWs(websocket)
    }

    connectWebSocket()

    return () => {
      if (ws) {
        ws.close()
      }
    }
  }, [])

  // Fetch status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/status`)
        const data = await response.json()
        setStats({
          credentialsConfigured: data.credentials_configured,
          symbolsConfigured: data.symbols_configured,
          activeConnections: data.active_connections
        })
      } catch (error) {
        console.error('Failed to fetch status:', error)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)

    return () => clearInterval(interval)
  }, [])

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'alerts', label: 'Alerts', icon: AlertCircle },
    { id: 'orders', label: 'Orders', icon: FileText },
    { id: 'positions', label: 'Positions', icon: TrendingUp },
    { id: 'config', label: 'Configuration', icon: Settings },
  ]

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo">
              <TrendingUp size={32} className="logo-icon" />
              <div>
                <h1>
                  Trading Bot
                  {isElectron && <span className="electron-badge">Desktop</span>}
                </h1>
                <p className="subtitle">Bybit Automation Platform</p>
              </div>
            </div>
          </div>

          <div className="header-right">
            <button
              className="risk-mgmt-btn"
              onClick={() => setShowRiskModal(true)}
              title="Risk Management"
            >
              <Shield size={18} />
              Risk
            </button>

            <div className="status-badge">
              <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>

            <div className="stats-mini">
              <div className="stat-item">
                <span className="stat-label">Symbols</span>
                <span className="stat-value">{stats.symbolsConfigured}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Clients</span>
                <span className="stat-value">{stats.activeConnections}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="tabs">
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'dashboard' && (
          <div className="dashboard">
            <div className="dashboard-grid">
              <div className="dashboard-left">
                <div className="dashboard-section">
                  <h2>Credentials</h2>
                  <CredentialsPanel onCredentialsSet={() => {}} />
                </div>

                <div className="dashboard-section">
                  <h2>Recent Logs</h2>
                  <LogsPanel logs={logs} maxHeight="400px" />
                </div>
              </div>

              <div className="dashboard-right">
                <div className="dashboard-section">
                  <h2>Alert Origins</h2>
                  <AlertOriginsPanel />
                </div>

                <div className="dashboard-section">
                  <h2>Trading Directions</h2>
                  <DirectionManager />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="alerts-tab">
            <AlertPanel />
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="orders-tab">
            <OrdersPanel />
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="positions-tab">
            <PositionsPanel />
          </div>
        )}

        {activeTab === 'config' && (
          <div className="config-tab">
            <ConfigManager />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Trading Bot Desktop v1.0.0 | Built with React + FastAPI + Bybit API{isElectron ? ' | Electron' : ''}</p>
      </footer>

      {/* Risk Management Modal */}
      <RiskManagementModal
        isOpen={showRiskModal}
        onClose={() => setShowRiskModal(false)}
      />
    </div>
  )
}

export default App
