// src/components/drawing/TextEditModal.jsx
// Modal para editar texto de TextBox sin bloquear el thread

import React, { useState, useEffect, useRef } from 'react';
import './TextEditModal.css';

const TextEditModal = ({ initialText = '', initialStyle = {}, onSave, onCancel }) => {
  // Si el texto inicial es el placeholder, empezar vacío
  const isPlaceholder = initialText === 'Escribe aquí...' || initialText === 'Texto...';
  const [text, setText] = useState(isPlaceholder ? '' : initialText);

  // Estados para estilos
  const [bgColor, setBgColor] = useState(initialStyle.bgColor || '#FBBF24');
  const [textColor, setTextColor] = useState(initialStyle.textColor || '#78350F');
  const [fontSize, setFontSize] = useState(initialStyle.fontSize || 13);
  const [bgOpacity, setBgOpacity] = useState(1.0);

  const inputRef = useRef(null);

  // Auto-focus cuando se monta el componente
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (!isPlaceholder) {
        inputRef.current.select(); // Seleccionar todo el texto solo si no es placeholder
      }
    }
  }, []);

  // Manejar Enter para guardar
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleSave = () => {
    // Convertir opacidad hexadecimal (00-FF)
    const opacityHex = Math.round(bgOpacity * 255).toString(16).padStart(2, '0');
    const bgColorWithOpacity = bgColor + opacityHex;

    const styles = {
      bgColor: bgColorWithOpacity,
      textColor,
      fontSize
    };

    onSave(text, styles);
  };

  return (
    <div className="text-edit-modal-overlay" onClick={onCancel}>
      <div className="text-edit-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="text-edit-modal-header">
          <h3>Editar Texto</h3>
          <button className="text-edit-modal-close-btn" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="text-edit-modal-body">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu anotación aquí..."
            rows={4}
            className="text-edit-input"
            style={{
              backgroundColor: bgColor + Math.round(bgOpacity * 255).toString(16).padStart(2, '0'),
              color: textColor,
              fontSize: `${fontSize}px`
            }}
          />

          {/* Controles de estilo */}
          <div className="text-style-controls">
            <div className="style-control-row">
              <label>
                Color de fondo:
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="color-input"
                />
              </label>

              <label>
                Opacidad:
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={bgOpacity}
                  onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                  className="range-input"
                />
                <span className="opacity-value">{Math.round(bgOpacity * 100)}%</span>
              </label>
            </div>

            <div className="style-control-row">
              <label>
                Color de texto:
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="color-input"
                />
              </label>

              <label>
                Tamaño:
                <input
                  type="number"
                  min="10"
                  max="40"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="number-input"
                />
                <span className="size-unit">px</span>
              </label>
            </div>
          </div>

          <div className="text-edit-helper">
            💡 Enter para guardar, Shift+Enter para nueva línea, Esc para cancelar
          </div>
        </div>

        <div className="text-edit-modal-footer">
          <button className="text-edit-btn text-edit-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button className="text-edit-btn text-edit-btn-save" onClick={handleSave}>
            Guardar Texto
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextEditModal;
