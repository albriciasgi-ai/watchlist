// src/components/drawing/TextEditModal.jsx
// Modal para editar texto de TextBox sin bloquear el thread

import React, { useState, useEffect, useRef } from 'react';
import './TextEditModal.css';

const TextEditModal = ({ initialText = '', onSave, onCancel }) => {
  const [text, setText] = useState(initialText);
  const inputRef = useRef(null);

  // Auto-focus cuando se monta el componente
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select(); // Seleccionar todo el texto
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
    onSave(text);
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
          />
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
