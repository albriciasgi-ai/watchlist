import React, { useState, useEffect, useRef } from 'react';
import { roleLabel } from '../indicators/analysisLevels.js';
import { screenshotUrl } from './observer.js';
import { EXIT_CAPTURE_CANDLES } from './tradeJournal.js';

import { useHostDocument } from './PopupWindow';
/**
 * Imágenes de un trade. "captions" dice qué muestra cada una y "aside" es lo que se quiere leer
 * junto a la imagen, como las medidas de la orden. "markers" ubica en cada imagen los niveles y
 * marcas elegidos ("items"): al pasar el mouse se ve su nota, y con "onGoTo" se va a ese punto.
 */
const ScreenshotModal = ({
  screenshotPath, exitScreenshotPath, decisionScreenshotPath, orderId, side, pnl, onClose, initialView, captions = {}, aside,
  markers = {}, items = [], onGoTo = null
}) => {
  const hostDocument = useHostDocument();
  const views = [
    ...(decisionScreenshotPath ? [['decision', 'Decisión', decisionScreenshotPath]] : []),
    ['entry', 'Apertura', screenshotPath],
    ['exit', 'Cierre', exitScreenshotPath]
  ];
  const available = views.filter(([, , path]) => path).map(([key]) => key);

  const [view, setView] = useState(initialView ?? available[0]);
  const activePath = views.find(([key]) => key === view)?.[2];
  const [loadedPath, setLoadedPath] = useState(null);
  const [failedPath, setFailedPath] = useState(null);
  const [actualSize, setActualSize] = useState(false);
  const imageRef = useRef(null);
  const [box, setBox] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [goProblem, setGoProblem] = useState(null);

  const error = !activePath ? 'Ruta de screenshot no válida' : failedPath === activePath ? 'No se pudo cargar la imagen' : null;
  const loading = !error && loadedPath !== activePath;

  // Cada marca con lo elegido que representa. El número es su lugar en la lista de la orden
  const shownMarkers = (markers[view] || []).flatMap(marker => {
    const index = items.findIndex(item => item.id === marker.id);
    return index < 0 ? [] : [{ ...marker, item: items[index], number: index + 1 }];
  });
  const focused = shownMarkers.find(marker => marker.id === (selected ?? hovered));

  useEffect(() => {
    setSelected(null);
    setHovered(null);
    setGoProblem(null);
  }, [view]);

  // Las marcas van sobre la imagen tal como se ve, también a tamaño real
  useEffect(() => {
    const image = imageRef.current;
    if (!image || loading || error) {
      setBox(null);
      return undefined;
    }
    const update = () => setBox({ left: image.offsetLeft, top: image.offsetTop, width: image.offsetWidth, height: image.offsetHeight });
    update();
    // El de la ventana de la imagen: en la ventana aparte, el de la principal no la mide
    const Observer = image.ownerDocument?.defaultView?.ResizeObserver || window.ResizeObserver;
    if (!Observer) return undefined;
    const observer = new Observer(update);
    observer.observe(image);
    // Al cambiar la ventana el cuerpo puede recentrar la imagen sin cambiarle el tamaño
    if (image.parentElement) observer.observe(image.parentElement);
    return () => observer.disconnect();
  }, [loading, error, activePath, actualSize]);

  const goTo = (item) => {
    const problem = onGoTo(item);
    if (problem) setGoProblem(problem);
    else onClose();
  };

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
        e.stopPropagation(); // Escape también oculta el panel de trading
        onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation(); // Las flechas también mueven la simulación
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        setView(current => available[(available.indexOf(current) + step + available.length) % available.length]);
      }
    };

    // En la ventana donde se abrió el visor: la principal o la aparte del Observador
    hostDocument.addEventListener('keydown', handleEscape);
    return () => hostDocument.removeEventListener('keydown', handleEscape);
  }, [onClose, available.join(), hostDocument]);

  /**
   * Determina el color del badge según el PnL
   */
  const getBadgeColor = () => {
    if (pnl > 0) return '#26a69a'; // Verde para ganancia
    if (pnl < 0) return '#ef5350'; // Rojo para pérdida
    return '#757575'; // Gris para empate
  };

  const body = (
    <div className={`screenshot-modal-body${actualSize ? ' actual-size' : ''}`}>
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

      {activePath && !error && (
        <img
          ref={imageRef}
          src={screenshotUrl(activePath)}
          alt={`Screenshot del trade #${orderId}`}
          className="screenshot-modal-image"
          title={actualSize ? 'Ajustar a la ventana' : 'Ver a tamaño real'}
          style={loading ? { display: 'none' } : undefined}
          onClick={() => setActualSize(current => !current)}
          onLoad={() => setLoadedPath(activePath)}
          onError={() => setFailedPath(activePath)}
        />
      )}

      {box && shownMarkers.length > 0 && (
        <div className="screenshot-markers" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          {shownMarkers.map(marker => (
            <button
              key={marker.id}
              type="button"
              className={`screenshot-marker${selected === marker.id ? ' selected' : ''}`}
              style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
              onMouseEnter={() => setHovered(marker.id)}
              onMouseLeave={() => setHovered(current => (current === marker.id ? null : current))}
              onClick={(e) => {
                e.stopPropagation();
                setGoProblem(null);
                setSelected(current => (current === marker.id ? null : marker.id));
              }}
            >
              {marker.number}
            </button>
          ))}
          {focused && (
            <div
              className={`screenshot-marker-note${focused.x > 0.6 ? ' to-left' : ''}`}
              style={{ left: `${focused.x * 100}%`, top: `${focused.y * 100}%` }}
              onClick={(e) => e.stopPropagation()}
            >
              <div><strong>{focused.item.kind}</strong> · {focused.item.source}</div>
              <div className="screenshot-marker-role">{roleLabel(focused.item.role)}</div>
              {focused.item.note
                ? <p>{focused.item.note}</p>
                : <p className="screenshot-marker-empty">Sin nota</p>}
              {selected === focused.id && onGoTo && (
                <button type="button" className="btn-quick" onClick={() => goTo(focused.item)}>Ir al gráfico</button>
              )}
              {selected === focused.id && goProblem && <div className="screenshot-marker-problem">{goProblem}</div>}
              {selected !== focused.id && onGoTo && <div className="screenshot-marker-hint">Clic en la marca para ir a ese punto</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="screenshot-modal-overlay" onClick={handleOverlayClick}>
      <div className={`screenshot-modal-content${aside ? ' with-aside' : ''}`}>
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
            {typeof pnl === 'number' && (
              <span
                style={{
                  marginLeft: '8px',
                  color: getBadgeColor(),
                  fontWeight: 'bold'
                }}
              >
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USD
              </span>
            )}
            <span style={{ display: 'flex', gap: '6px', marginLeft: '16px' }}>
              {views.map(([key, label, path]) => (
                <button
                  key={key}
                  disabled={!path}
                  onClick={() => setView(key)}
                  title={path ? '← → cambia de imagen' : `Se toma ${EXIT_CAPTURE_CANDLES} velas después de cerrar`}
                  style={{
                    background: view === key ? '#2962ff' : '#e0e0e0',
                    color: view === key ? 'white' : '#333',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '3px 12px',
                    fontSize: '13px',
                    cursor: path ? 'pointer' : 'not-allowed',
                    opacity: path ? 1 : 0.5
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
            {captions[view] && (
              <span style={{ marginLeft: '12px', fontSize: '12px', fontWeight: 'normal', color: '#666' }}>{captions[view]}</span>
            )}
          </div>
          <button className="screenshot-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        {aside
          ? (
            <div className="screenshot-review">
              {body}
              <div className="screenshot-review-aside">{aside}</div>
            </div>
          )
          : body}

        {/* Footer */}
        {!loading && !error && (
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
