// src/components/drawing/ColorPickerModal.jsx
// Modal para cambiar color de líneas (TrendLine, HorizontalLine, VerticalLine)

import React, { useState } from 'react';
import './ColorPickerModal.css';

const ColorPickerModal = ({ currentColor, shapeName, onSave, onCancel }) => {
  const [selectedColor, setSelectedColor] = useState(currentColor);

  // Paleta de colores predefinidos (estilo TradingView)
  const colorPalette = [
    { name: 'Azul', hex: '#3B82F6' },
    { name: 'Púrpura', hex: '#8B5CF6' },
    { name: 'Rosa', hex: '#EC4899' },
    { name: 'Rojo', hex: '#EF4444' },
    { name: 'Naranja', hex: '#F59E0B' },
    { name: 'Amarillo', hex: '#FBBF24' },
    { name: 'Verde Lima', hex: '#84CC16' },
    { name: 'Verde', hex: '#10B981' },
    { name: 'Esmeralda', hex: '#059669' },
    { name: 'Teal', hex: '#14B8A6' },
    { name: 'Cyan', hex: '#06B6D4' },
    { name: 'Azul Cielo', hex: '#0EA5E9' },
    { name: 'Índigo', hex: '#6366F1' },
    { name: 'Violeta', hex: '#A855F7' },
    { name: 'Fucsia', hex: '#D946EF' },
    { name: 'Gris Oscuro', hex: '#4B5563' },
    { name: 'Gris', hex: '#6B7280' },
    { name: 'Gris Claro', hex: '#9CA3AF' },
    { name: 'Blanco', hex: '#FFFFFF' },
    { name: 'Negro', hex: '#000000' }
  ];

  const handleSave = () => {
    onSave(selectedColor);
  };

  return (
    <div className="color-picker-modal-overlay" onClick={onCancel}>
      <div className="color-picker-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-modal-header">
          <h3>Seleccionar Color - {shapeName}</h3>
          <button className="color-picker-modal-close-btn" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="color-picker-modal-body">
          <div className="color-palette">
            {colorPalette.map((color) => (
              <button
                key={color.hex}
                className={`color-swatch ${selectedColor === color.hex ? 'selected' : ''}`}
                style={{ backgroundColor: color.hex }}
                onClick={() => setSelectedColor(color.hex)}
                title={color.name}
              >
                {selectedColor === color.hex && (
                  <span className="color-checkmark">✓</span>
                )}
              </button>
            ))}
          </div>

          <div className="color-preview">
            <div className="color-preview-label">Vista previa:</div>
            <div className="color-preview-line">
              <div
                className="preview-line-sample"
                style={{ borderColor: selectedColor }}
              ></div>
              <span className="color-preview-hex">{selectedColor}</span>
            </div>
          </div>

          <div className="color-custom">
            <label htmlFor="custom-color">Color personalizado:</label>
            <input
              id="custom-color"
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="color-custom-input"
            />
          </div>
        </div>

        <div className="color-picker-modal-footer">
          <button className="color-picker-btn color-picker-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button className="color-picker-btn color-picker-btn-save" onClick={handleSave}>
            Aplicar Color
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal;
