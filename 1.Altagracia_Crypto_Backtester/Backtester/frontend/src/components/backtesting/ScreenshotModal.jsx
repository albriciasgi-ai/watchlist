import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:9000';

const ScreenshotModal = ({ screenshotPath, orderId, side, pnl, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);

  /**
   * Carga la imagen desde el backend
   */
  useEffect(() => {
    if (!screenshotPath) {
      setError('Ruta de screenshot no válida');
      setLoading(false);
      return;
    }

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);

        // Construir URL completa
        // screenshotPath tiene formato: "sessionId/filename.png"
        // Necesitamos separarlo para el endpoint: /api/screenshots/session/{sessionId}/{filename}
        const pathParts = screenshotPath.split('/');
        if (pathParts.length !== 2) {
          throw new Error(`Formato de screenshotPath inválido: ${screenshotPath}`);
        }
        const [sessionId, filename] = pathParts;
        const url = `${API_BASE_URL}/api/screenshots/session/${sessionId}/${filename}`;

        console.log('[ScreenshotModal] Cargando screenshot:', url);

        // Verificar que la imagen existe
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Usar la URL directamente en el img
        setImageUrl(url);
        setLoading(false);

        console.log('[ScreenshotModal] ✅ Screenshot cargado correctamente');
      } catch (err) {
        console.error('[ScreenshotModal] ❌ Error cargando screenshot:', err);
        setError(`Error cargando screenshot: ${err.message}`);
        setLoading(false);
      }
    };

    loadImage();
  }, [screenshotPath]);

  /**
   * Maneja el clic en el overlay (cerrar modal)
   */
  const handleOverlayClick = (e) => {
    // Solo cerrar si el clic es en el overlay, no en el contenido
    if (e.target.className === 'screenshot-modal-overlay') {
      onClose();
    }
  };

  /**
   * Maneja la tecla Escape para cerrar
   */
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  /**
   * Determina el color del badge según el PnL
   */
  const getBadgeColor = () => {
    if (pnl > 0) return '#26a69a'; // Verde para ganancia
    if (pnl < 0) return '#ef5350'; // Rojo para pérdida
    return '#757575'; // Gris para empate
  };

  return (
    <div className="screenshot-modal-overlay" onClick={handleOverlayClick}>
      <div className="screenshot-modal-content">
        {/* Header */}
        <div className="screenshot-modal-header">
          <div className="screenshot-modal-title">
            <span className="screenshot-modal-icon">📸</span>
            <span>Trade #{orderId}</span>
            <span
              className="screenshot-modal-badge"
              style={{
                backgroundColor: getBadgeColor(),
                color: 'white',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                marginLeft: '8px'
              }}
            >
              {side === 'long' ? '📈 LONG' : '📉 SHORT'}
            </span>
            <span
              style={{
                marginLeft: '8px',
                color: getBadgeColor(),
                fontWeight: 'bold'
              }}
            >
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USD
            </span>
          </div>
          <button className="screenshot-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="screenshot-modal-body">
          {loading && (
            <div className="screenshot-modal-loading">
              <div className="spinner"></div>
              <p>Cargando screenshot...</p>
            </div>
          )}

          {error && (
            <div className="screenshot-modal-error">
              <span style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</span>
              <p>{error}</p>
              <button onClick={onClose}>Cerrar</button>
            </div>
          )}

          {imageUrl && !loading && !error && (
            <img
              src={imageUrl}
              alt={`Screenshot del trade #${orderId}`}
              className="screenshot-modal-image"
              onError={() => {
                setError('No se pudo cargar la imagen');
                setImageUrl(null);
              }}
            />
          )}
        </div>

        {/* Footer */}
        {imageUrl && !loading && !error && (
          <div className="screenshot-modal-footer">
            <button onClick={onClose} className="screenshot-modal-close-button">
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScreenshotModal;
