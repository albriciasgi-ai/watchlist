import React, { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import TradeList from './components/TradeList'
import TradeDetail from './components/TradeDetail'
import Settings from './components/Settings'
import './styles/App.css'

const API_BASE = '/api'

function App() {
  const [view, setView] = useState('dashboard')
  const [selectedTradeId, setSelectedTradeId] = useState(null)
  const [monitorStatus, setMonitorStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMonitorStatus()
    const interval = setInterval(fetchMonitorStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchMonitorStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/monitor/status`)
      const data = await res.json()
      setMonitorStatus(data)
      setLoading(false)
    } catch (err) {
      console.error('Error fetching monitor status:', err)
      setMonitorStatus({ running: false, error: 'Backend no disponible' })
      setLoading(false)
    }
  }

  const handleViewTrade = (tradeId) => {
    setSelectedTradeId(tradeId)
    setView('detail')
  }

  const handleBack = () => {
    setSelectedTradeId(null)
    setView('trades')
  }

  const renderContent = () => {
    switch (view) {
      case 'dashboard':
        return <Dashboard onViewTrade={handleViewTrade} />
      case 'trades':
        return <TradeList onViewTrade={handleViewTrade} />
      case 'detail':
        return <TradeDetail tradeId={selectedTradeId} onBack={handleBack} />
      case 'settings':
        return <Settings monitorStatus={monitorStatus} onRefresh={fetchMonitorStatus} />
      default:
        return <Dashboard onViewTrade={handleViewTrade} />
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 6-10" />
          </svg>
          Trading Journal
        </h1>

        <div className="header-status">
          <span className={`status-dot ${monitorStatus?.running ? 'online' : 'offline'}`}></span>
          <span className="status-text">
            {loading ? 'Conectando...' : monitorStatus?.running ? 'Monitor activo' : 'Monitor inactivo'}
          </span>
          {monitorStatus?.tracked_positions > 0 && (
            <span className="tracked-count">{monitorStatus.tracked_positions} posiciones</span>
          )}
        </div>

        <nav className="app-nav">
          <button
            className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn ${view === 'trades' ? 'active' : ''}`}
            onClick={() => setView('trades')}
          >
            Trades
          </button>
          <button
            className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="app-content">
        {renderContent()}
      </main>
    </div>
  )
}

export default App
