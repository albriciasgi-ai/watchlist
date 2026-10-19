// FootprintArchivePanel.jsx - Panel UI para gestionar archivo de footprints históricos
//
// Permite configurar, ejecutar y monitorear el archivado automático de footprints.

import React, { useState, useEffect } from 'react';
import { getFootprintArchiver } from '../services/FootprintArchiverElectron';
import { getArchiveScheduler } from '../services/ArchiveScheduler';
import './FootprintArchivePanel.css';

const FootprintArchivePanel = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState(null);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  // Configuración del scheduler
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [hour, setHour] = useState(3);
  const [hoursToArchive, setHoursToArchive] = useState(24);  // 24h en lugar de 168h por timeout

  const daysOfWeek = [
    'Domingo', 'Lunes', 'Martes', 'Miércoles',
    'Jueves', 'Viernes', 'Sábado'
  ];

  useEffect(() => {
    if (isOpen) {
      loadStats();
      loadSchedulerStatus();
    }
  }, [isOpen]);

  const loadStats = async () => {
    const archiver = getFootprintArchiver();
    const archiveStats = await archiver.getArchiveStats();
    setStats(archiveStats);
  };

  const loadSchedulerStatus = () => {
    const scheduler = getArchiveScheduler();
    const status = scheduler.getStatus();
    setSchedulerStatus(status);

    // Cargar config en el form
    setDayOfWeek(status.config.dayOfWeek);
    setHour(status.config.hour);
    setHoursToArchive(status.config.hoursToArchive);
  };

  const handleDownloadNow = async () => {
    setDownloading(true);
    setProgress({ symbol: 'Iniciando...', current: 0, total: 10 });

    const archiver = getFootprintArchiver();

    // Usar 720 horas (30 días / 1 mes) - datos disponibles en Northflank
    const result = await archiver.archiveAll(720, (prog) => {
      setProgress(prog);
    });

    setLastResult(result);
    setDownloading(false);
    setProgress(null);

    // Recargar stats
    await loadStats();
    loadSchedulerStatus();
  };

  const handleToggleScheduler = () => {
    const scheduler = getArchiveScheduler();

    if (schedulerStatus.enabled) {
      scheduler.stop();
    } else {
      scheduler.start();
    }

    loadSchedulerStatus();
  };

  const handleSaveSchedulerConfig = () => {
    const scheduler = getArchiveScheduler();

    scheduler.configure({
      dayOfWeek: parseInt(dayOfWeek),
      hour: parseInt(hour),
      hoursToArchive: parseInt(hoursToArchive)
    });

    loadSchedulerStatus();

    alert('Configuración guardada correctamente');
  };

  const handleExportSymbol = async (symbol) => {
    const archiver = getFootprintArchiver();
    const blob = await archiver.exportToJSON(symbol);

    // Descargar archivo
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_footprints_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="archive-panel-overlay" onClick={onClose}>
      <div className="archive-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="archive-panel-header">
          <h2>📚 Archivo de Footprints Históricos</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Content */}
        <div className="archive-panel-content">

          {/* Estadísticas del Archivo */}
          <div className="archive-section">
            <h3>📊 Estadísticas del Archivo Local</h3>
            {stats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Símbolos archivados</div>
                  <div className="stat-value">{stats.symbolsArchived}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total footprints</div>
                  <div className="stat-value">{stats.totalFootprints.toLocaleString()}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Rango de datos</div>
                  <div className="stat-value-small">
                    {stats.oldestTimestamp ? formatDate(stats.oldestTimestamp) : 'N/A'}
                    <br/>→<br/>
                    {stats.newestTimestamp ? formatDate(stats.newestTimestamp) : 'N/A'}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Última descarga</div>
                  <div className="stat-value-small">
                    {stats.lastRun ? formatDate(stats.lastRun.timestamp) : 'Nunca'}
                  </div>
                </div>
              </div>
            ) : (
              <p>Cargando estadísticas...</p>
            )}
          </div>

          {/* Descarga Manual */}
          <div className="archive-section">
            <h3>📥 Descarga Manual</h3>
            <p className="section-description">
              Descarga los footprints más recientes desde Northflank ahora mismo.
            </p>

            {downloading && progress && (
              <div className="download-progress">
                <div className="progress-header">
                  <span>{progress.symbol}</span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              </div>
            )}

            {lastResult && (
              <div className={`result-message ${lastResult.success ? 'success' : 'error'}`}>
                {lastResult.success ? (
                  <>
                    ✅ Descarga completada: {lastResult.totalAdded} nuevos footprints
                    ({lastResult.successful}/{lastResult.successful + lastResult.failed} símbolos exitosos)
                  </>
                ) : (
                  <>❌ Error: {lastResult.error}</>
                )}
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleDownloadNow}
              disabled={downloading}
            >
              {downloading ? '⏳ Descargando...' : '📥 Descargar Ahora (Último Mes - 30 días)'}
            </button>
          </div>

          {/* Programación Automática */}
          <div className="archive-section">
            <h3>⏰ Programación Automática</h3>
            <p className="section-description">
              Configura descargas automáticas semanales para construir tu biblioteca histórica.
            </p>

            {schedulerStatus && (
              <div className="scheduler-config">
                <div className="config-row">
                  <label>Estado:</label>
                  <div className="scheduler-status">
                    <span className={`status-badge ${schedulerStatus.enabled ? 'active' : 'inactive'}`}>
                      {schedulerStatus.enabled ? '✅ Activo' : '⏸️ Inactivo'}
                    </span>
                    <button
                      className={`btn btn-small ${schedulerStatus.enabled ? 'btn-danger' : 'btn-success'}`}
                      onClick={handleToggleScheduler}
                    >
                      {schedulerStatus.enabled ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>

                <div className="config-row">
                  <label>Día de la semana:</label>
                  <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                    {daysOfWeek.map((day, idx) => (
                      <option key={idx} value={idx}>{day}</option>
                    ))}
                  </select>
                </div>

                <div className="config-row">
                  <label>Hora (0-23):</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                  />
                </div>

                <div className="config-row">
                  <label>Horas a archivar:</label>
                  <select value={hoursToArchive} onChange={(e) => setHoursToArchive(e.target.value)}>
                    <option value="168">1 semana (168 horas)</option>
                    <option value="336">2 semanas (336 horas)</option>
                    <option value="720">1 mes (720 horas)</option>
                  </select>
                </div>

                <button className="btn btn-secondary" onClick={handleSaveSchedulerConfig}>
                  💾 Guardar Configuración
                </button>

                {schedulerStatus.enabled && (
                  <div className="scheduler-info">
                    <p>
                      <strong>Próxima ejecución:</strong> {schedulerStatus.nextRunDate}
                      <br/>
                      <small>(En {schedulerStatus.daysUntilNextRun} día{schedulerStatus.daysUntilNextRun !== 1 ? 's' : ''})</small>
                    </p>
                    {schedulerStatus.lastRunDate && (
                      <p>
                        <strong>Última ejecución:</strong> {schedulerStatus.lastRunDate}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Detalles por Símbolo */}
          {stats && stats.symbolDetails && stats.symbolDetails.length > 0 && (
            <div className="archive-section">
              <h3>📋 Detalles por Símbolo</h3>
              <div className="symbol-details-table">
                <table>
                  <thead>
                    <tr>
                      <th>Símbolo</th>
                      <th>Footprints</th>
                      <th>Desde</th>
                      <th>Hasta</th>
                      <th>Última Descarga</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.symbolDetails.map((detail) => (
                      <tr key={detail.symbol}>
                        <td><strong>{detail.symbol}</strong></td>
                        <td>{detail.totalFootprints?.toLocaleString() || 0}</td>
                        <td className="date-cell">
                          {detail.oldestTimestamp ? formatDate(detail.oldestTimestamp) : 'N/A'}
                        </td>
                        <td className="date-cell">
                          {detail.newestTimestamp ? formatDate(detail.newestTimestamp) : 'N/A'}
                        </td>
                        <td className="date-cell">
                          {detail.lastDownload ? formatDate(detail.lastDownload) : 'N/A'}
                        </td>
                        <td>
                          <button
                            className="btn btn-small btn-export"
                            onClick={() => handleExportSymbol(detail.symbol)}
                            title="Exportar a JSON"
                          >
                            💾
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="archive-panel-footer">
          <p className="footer-note">
            💡 <strong>Tip:</strong> Los footprints se descargan de Northflank y se guardan localmente en IndexedDB.
            Puedes exportarlos a JSON para backups externos.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FootprintArchivePanel;
