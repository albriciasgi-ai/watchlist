import { useState, useEffect } from 'react'
import { Activity, Settings, TrendingUp, AlertCircle, Play, Pause, FileText } from 'lucide-react'
import './App.css'
import CredentialsPanel from './components/CredentialsPanel'
import DirectionManager from './components/DirectionManager'
import ConfigManager from './components/ConfigManager'
import AlertPanel from './components/AlertPanel'
import LogsPanel from './components/LogsPanel'
import PositionsPanel from './components/PositionsPanel'
import OrdersPanel from './components/OrdersPanel'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isConnected, setIsConnected] = useState(false)
  const [logs, setLogs] = useState([])
  const [ws, setWs] = useState(null)
  const [stats, setStats] = useState({
    credentialsConfigured: false,
    symbolsConfigured: 0,
    activeConnections: 0
  })

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const wsUrl = `ws://localhost:8001/ws`
      const websocket = new WebSocket(wsUrl)

      websocket.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
      }

      websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'log') {
            setLogs(prev => [...prev, message.data].slice(-1000))
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
        const response = await fetch('/api/status')
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
                <h1>Trading Bot</h1>
                <p className="subtitle">Bybit Automation Platform</p>
              </div>
            </div>
          </div>

          <div className="header-right">
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
        <p>Trading Bot v1.0.0 | Built with React + FastAPI + Bybit API</p>
      </footer>
    </div>
  )
}

export default App
