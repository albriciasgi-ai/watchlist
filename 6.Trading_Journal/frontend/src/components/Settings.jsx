import React, { useState, useEffect } from 'react'
import './Settings.css'

const API_BASE = '/api'

function Settings({ monitorStatus, onRefresh }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importFile, setImportFile] = useState(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/monitor/status`)
      if (res.ok) {
        const data = await res.json()
        setConfig({
          running: data.running || false,
          poll_interval: data.poll_interval || 5,
          screenshot_on_entry: data.screenshot_on_entry ?? true,
          screenshot_on_exit: data.screenshot_on_exit ?? true
        })
      }
      setLoading(false)
    } catch (err) {
      console.error('Error fetching config:', err)
      setLoading(false)
    }
  }

  const handleToggleMonitor = async () => {
    try {
      setSaving(true)
      const endpoint = config.running ? '/monitor/stop' : '/monitor/start'
      const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' })
      if (res.ok) {
        await fetchConfig()
        onRefresh()
      }
      setSaving(false)
    } catch (err) {
      console.error('Error toggling monitor:', err)
      setSaving(false)
    }
  }

  const handleExport = async () => {
    try {
      setExportLoading(true)
      const res = await fetch(`${API_BASE}/entries/export`)
      if (res.ok) {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `trading_journal_export_${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      setExportLoading(false)
    } catch (err) {
      console.error('Error exporting:', err)
      setExportLoading(false)
    }
  }

  const handleImport = async () => {
    if (!importFile) return

    try {
      setSaving(true)
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result)
          const res = await fetch(`${API_BASE}/entries/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          })
          if (res.ok) {
            const result = await res.json()
            alert(`Importación completada: ${result.imported} trades importados`)
            setImportFile(null)
          } else {
            alert('Error al importar datos')
          }
        } catch (parseErr) {
          alert('Archivo JSON inválido')
        }
        setSaving(false)
      }
      reader.readAsText(importFile)
    } catch (err) {
      console.error('Error importing:', err)
      setSaving(false)
    }
  }

  const handleClearScreenshots = async () => {
    if (!confirm('¿Estás seguro de eliminar todos los screenshots? Esta acción no se puede deshacer.')) {
      return
    }

    try {
      const res = await fetch(`${API_BASE}/screenshots/clear`, { method: 'POST' })
      if (res.ok) {
        alert('Screenshots eliminados')
      }
    } catch (err) {
      console.error('Error clearing screenshots:', err)
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Cargando configuración...
      </div>
    )
  }

  return (
    <div className="settings-container">
      {/* Monitor Status Card */}
      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Monitor de Posiciones</h3>
          <span className={`status-badge ${monitorStatus?.running ? 'active' : 'inactive'}`}>
            {monitorStatus?.running ? 'Activo' : 'Inactivo'}
          </span>
        </div>

        <div className="settings-content">
          <div className="monitor-info">
            <div className="info-row">
              <span className="info-label">Estado</span>
              <span className="info-value">
                <span className={`status-dot ${monitorStatus?.running ? 'online' : 'offline'}`}></span>
                {monitorStatus?.running ? 'Monitoreando' : 'Detenido'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Posiciones Rastreadas</span>
              <span className="info-value">{monitorStatus?.tracked_positions || 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Intervalo de Polling</span>
              <span className="info-value">{monitorStatus?.poll_interval || 5}s</span>
            </div>
            {monitorStatus?.last_check && (
              <div className="info-row">
                <span className="info-label">Última Verificación</span>
                <span className="info-value">
                  {new Date(monitorStatus.last_check).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>

          <div className="monitor-actions">
            <button
              className={`btn ${monitorStatus?.running ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleToggleMonitor}
              disabled={saving}
            >
              {saving ? 'Procesando...' : monitorStatus?.running ? 'Detener Monitor' : 'Iniciar Monitor'}
            </button>
            <button className="btn btn-secondary" onClick={onRefresh}>
              Actualizar Estado
            </button>
          </div>
        </div>
      </div>

      {/* Screenshot Settings */}
      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Screenshots</h3>
        </div>

        <div className="settings-content">
          <p className="settings-description">
            Los screenshots se capturan automáticamente cuando se abre o cierra una posición.
            Requiere que el Analizador o Watchlist esté abierto en el navegador.
          </p>

          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config?.screenshot_on_entry ?? true}
                onChange={e => setConfig({ ...config, screenshot_on_entry: e.target.checked })}
              />
              <span>Capturar al abrir posición</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config?.screenshot_on_exit ?? true}
                onChange={e => setConfig({ ...config, screenshot_on_exit: e.target.checked })}
              />
              <span>Capturar al cerrar posición</span>
            </label>
          </div>

          <div className="settings-actions">
            <button className="btn btn-secondary btn-danger-text" onClick={handleClearScreenshots}>
              Eliminar Todos los Screenshots
            </button>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Gestión de Datos</h3>
        </div>

        <div className="settings-content">
          <div className="data-section">
            <h4>Exportar</h4>
            <p className="settings-description">
              Exporta todos tus trades a un archivo JSON para respaldo.
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleExport}
              disabled={exportLoading}
            >
              {exportLoading ? 'Exportando...' : 'Exportar Trades (JSON)'}
            </button>
          </div>

          <div className="data-section">
            <h4>Importar</h4>
            <p className="settings-description">
              Importa trades desde un archivo JSON previamente exportado.
            </p>
            <div className="import-group">
              <input
                type="file"
                accept=".json"
                onChange={e => setImportFile(e.target.files[0])}
                id="import-file"
              />
              <label htmlFor="import-file" className="btn btn-secondary">
                Seleccionar Archivo
              </label>
              {importFile && (
                <>
                  <span className="file-name">{importFile.name}</span>
                  <button
                    className="btn btn-primary"
                    onClick={handleImport}
                    disabled={saving}
                  >
                    {saving ? 'Importando...' : 'Importar'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Connection Info */}
      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Conexiones</h3>
        </div>

        <div className="settings-content">
          <div className="connections-list">
            <div className="connection-item">
              <div className="connection-info">
                <span className="connection-name">Trading Bot</span>
                <span className="connection-url">localhost:5000</span>
              </div>
              <span className={`connection-status ${monitorStatus?.tradingbot_connected ? 'connected' : 'disconnected'}`}>
                {monitorStatus?.tradingbot_connected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
            <div className="connection-item">
              <div className="connection-info">
                <span className="connection-name">Backend Journal</span>
                <span className="connection-url">localhost:12000</span>
              </div>
              <span className="connection-status connected">Conectado</span>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Acerca de</h3>
        </div>

        <div className="settings-content">
          <div className="about-info">
            <p><strong>Trading Journal</strong></p>
            <p>Sistema de registro automático de trades con análisis de rendimiento.</p>
            <p className="version">Versión 1.0.0</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
