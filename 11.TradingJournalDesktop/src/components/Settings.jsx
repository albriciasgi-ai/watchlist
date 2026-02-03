import React, { useState, useEffect } from 'react'
import { API_BASE_URL, APP_VERSION } from '../config'
import './Settings.css'

function Settings({ monitorStatus, onRefresh }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [reconciling, setReconciling] = useState(false)
  const [clearingHistory, setClearingHistory] = useState(false)

  // Estado para modal de confirmacion
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState('')

  // Estado para modal de mensaje
  const [messageModal, setMessageModal] = useState({ show: false, title: '', message: '' })

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/monitor/status`)
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
      const endpoint = config.running ? '/api/monitor/stop' : '/api/monitor/start'
      const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'POST' })
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
      const res = await fetch(`${API_BASE_URL}/api/entries/export`)
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
          const res = await fetch(`${API_BASE_URL}/api/entries/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          })
          if (res.ok) {
            const result = await res.json()
            alert(`Importacion completada: ${result.imported} trades importados`)
            setImportFile(null)
          } else {
            alert('Error al importar datos')
          }
        } catch (parseErr) {
          alert('Archivo JSON invalido')
        }
        setSaving(false)
      }
      reader.readAsText(importFile)
    } catch (err) {
      console.error('Error importing:', err)
      setSaving(false)
    }
  }

  // Funcion helper para mostrar mensajes (reemplaza alert)
  const showMessage = (title, message) => {
    setMessageModal({ show: true, title, message })
  }

  const handleReconcile = async () => {
    // Usar window.confirm con fallback
    const confirmed = window.confirm ? window.confirm('Esto cerrara entries huerfanas y sincronizara con TradingBot. Continuar?') : true
    if (!confirmed) return

    try {
      setReconciling(true)
      const res = await fetch(`${API_BASE_URL}/api/monitor/reconcile`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const closed = data.result?.closed_orphans || 0
        const created = data.result?.created_entries || 0
        showMessage('Reconciliacion Completada', `Entries cerradas: ${closed}\nEntries creadas: ${created}`)
        onRefresh()
      } else {
        showMessage('Error', 'Error en reconciliacion')
      }
    } catch (err) {
      console.error('Error reconciling:', err)
      showMessage('Error', 'Error de conexion')
    } finally {
      setReconciling(false)
    }
  }

  const handleClearScreenshots = async () => {
    const confirmed = window.confirm ? window.confirm('Estas seguro de eliminar todos los screenshots? Esta accion no se puede deshacer.') : true
    if (!confirmed) return

    try {
      const res = await fetch(`${API_BASE_URL}/api/screenshots/clear`, { method: 'POST' })
      if (res.ok) {
        showMessage('Exito', 'Screenshots eliminados')
      }
    } catch (err) {
      console.error('Error clearing screenshots:', err)
    }
  }

  // Abre el modal de confirmacion para borrar historial
  const openDeleteHistoryModal = () => {
    setDeleteConfirmText('')
    setDeleteError('')
    setShowDeleteModal(true)
  }

  // Ejecuta el borrado del historial
  const handleClearAllHistory = async () => {
    if (deleteConfirmText !== 'BORRAR TODO') {
      setDeleteError('Texto incorrecto. Escribe "BORRAR TODO" exactamente.')
      return
    }

    try {
      setClearingHistory(true)
      setShowDeleteModal(false)
      console.log('[Settings] Iniciando borrado de historial...')
      const res = await fetch(`${API_BASE_URL}/api/admin/clear-all-entries`, { method: 'DELETE' })
      console.log('[Settings] Respuesta recibida:', res.status)

      if (res.ok) {
        const data = await res.json()
        console.log('[Settings] Datos:', data)
        showMessage('Historial Eliminado', `${data.deleted_count} trades borrados`)
        onRefresh()
      } else {
        const errorText = await res.text()
        console.error('[Settings] Error del servidor:', errorText)
        showMessage('Error', `Error al eliminar historial: ${res.status}`)
      }
    } catch (err) {
      console.error('[Settings] Error clearing history:', err)
      showMessage('Error', `Error de conexion: ${err.message}`)
    } finally {
      setClearingHistory(false)
      setDeleteConfirmText('')
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Cargando configuracion...
      </div>
    )
  }

  return (
    <div className="settings-container">
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
                <span className="info-label">Ultima Verificacion</span>
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
            <button 
              className="btn btn-secondary" 
              onClick={handleReconcile}
              disabled={reconciling}
              title="Cierra entries huerfanas y crea entries para posiciones sin tracking"
            >
              {reconciling ? 'Reconciliando...' : 'Reconciliar'}
            </button>
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Screenshots</h3>
        </div>

        <div className="settings-content">
          <p className="settings-description">
            Los screenshots se capturan automaticamente cuando se abre o cierra una posicion.
            Requiere que el Analizador o Watchlist este abierto en el navegador.
          </p>

          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config?.screenshot_on_entry ?? true}
                onChange={e => setConfig({ ...config, screenshot_on_entry: e.target.checked })}
              />
              <span>Capturar al abrir posicion</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config?.screenshot_on_exit ?? true}
                onChange={e => setConfig({ ...config, screenshot_on_exit: e.target.checked })}
              />
              <span>Capturar al cerrar posicion</span>
            </label>
          </div>

          <div className="settings-actions">
            <button className="btn btn-secondary btn-danger-text" onClick={handleClearScreenshots}>
              Eliminar Todos los Screenshots
            </button>
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Gestion de Datos</h3>
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

          <div className="data-section danger-section">
            <h4>Zona de Peligro</h4>
            <p className="settings-description danger-text">
              Elimina permanentemente TODOS los trades del historial. Esta accion no se puede deshacer.
            </p>
            <button
              className="btn btn-danger"
              onClick={openDeleteHistoryModal}
              disabled={clearingHistory}
            >
              {clearingHistory ? 'Eliminando...' : 'Borrar Todo el Historial'}
            </button>
          </div>
        </div>
      </div>

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

      <div className="card settings-card">
        <div className="card-header">
          <h3 className="card-title">Acerca de</h3>
        </div>

        <div className="settings-content">
          <div className="about-info">
            <p><strong>Trading Journal Desktop</strong></p>
            <p>Sistema de registro automatico de trades con analisis de rendimiento.</p>
            <p className="version">Version {APP_VERSION}</p>
          </div>
        </div>
      </div>

      {/* Modal de confirmacion para borrar historial */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content danger-modal" onClick={e => e.stopPropagation()}>
            <h3>Borrar Todo el Historial</h3>
            <p className="danger-text">
              ADVERTENCIA: Esto eliminara TODOS los trades del historial.
              Esta accion NO se puede deshacer.
            </p>
            <p>Escribe <strong>"BORRAR TODO"</strong> para confirmar:</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => {
                setDeleteConfirmText(e.target.value)
                setDeleteError('')
              }}
              placeholder="BORRAR TODO"
              className="confirm-input"
              autoFocus
            />
            {deleteError && <p className="error-text">{deleteError}</p>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={handleClearAllHistory}
                disabled={clearingHistory}
              >
                {clearingHistory ? 'Eliminando...' : 'Confirmar Borrado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de mensaje */}
      {messageModal.show && (
        <div className="modal-overlay" onClick={() => setMessageModal({ show: false, title: '', message: '' })}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{messageModal.title}</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{messageModal.message}</p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => setMessageModal({ show: false, title: '', message: '' })}
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
