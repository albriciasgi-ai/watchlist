// src/components/ProximityAlerts/AlertConfigModal.jsx
import React, { useState, useEffect } from "react";
import "./AlertConfigModal.css";

const API_BASE_URL = "http://localhost:8000";

/**
 * AlertConfigModal - Modal para configurar alertas de proximidad
 *
 * Permite:
 * - Crear nueva alerta
 * - Editar alerta existente
 * - Seleccionar precio manual o desde S/R / Range Detector
 * - Configurar tolerancia y umbral de volumen
 */
const AlertConfigModal = ({ alert, symbols, onSave, onDelete, onClose }) => {
  const isEditing = Boolean(alert?.id && !alert.id.includes("disabled"));

  // Estado del formulario
  const [formData, setFormData] = useState({
    name: alert?.name || "",
    symbol: alert?.symbol || symbols[0] || "BTCUSDT",
    targetPrice: alert?.targetPrice || "",
    tolerancePct: alert?.tolerancePct || 1.0,
    volumeThresholdZScore: alert?.volumeThresholdZScore || 2.0,
    zScorePeriod: alert?.zScorePeriod || 50,
    enabled: alert?.enabled !== undefined ? alert.enabled : true,
    referenceSource: alert?.referenceSource || "manual",
    referenceId: alert?.referenceId || null,
  });

  // Estado para niveles de S/R y Range Detector
  const [loadingLevels, setLoadingLevels] = useState(false);
  const [availableLevels, setAvailableLevels] = useState({
    supports: [],
    resistances: [],
    ranges: [],
  });

  // Cargar niveles cuando cambia el símbolo o la fuente de referencia
  useEffect(() => {
    if (formData.referenceSource !== "manual" && formData.symbol) {
      loadAvailableLevels();
    }
  }, [formData.symbol, formData.referenceSource]);

  const loadAvailableLevels = async () => {
    setLoadingLevels(true);
    try {
      if (formData.referenceSource === "support_resistance") {
        // Cargar niveles de S/R
        const response = await fetch(
          `${API_BASE_URL}/api/support-resistance/${formData.symbol}?interval=15&days=30`
        );
        const data = await response.json();

        if (data.success) {
          setAvailableLevels({
            supports: data.data.supports || [],
            resistances: data.data.resistances || [],
            ranges: [],
          });
        }
      } else if (formData.referenceSource === "range_detector") {
        // TODO: Implementar carga de niveles de Range Detector
        // Por ahora, dejar vacío
        setAvailableLevels({
          supports: [],
          resistances: [],
          ranges: [],
        });
      }
    } catch (error) {
      console.error("Error loading levels:", error);
    } finally {
      setLoadingLevels(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSelectLevel = (price, type, id) => {
    setFormData((prev) => ({
      ...prev,
      targetPrice: price,
      referenceId: id,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validar campos requeridos
    if (!formData.symbol || !formData.targetPrice || !formData.name) {
      alert("Por favor completa todos los campos obligatorios");
      return;
    }

    // Generar ID si es nueva alerta
    const alertData = {
      ...formData,
      id: alert?.id || `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      targetPrice: parseFloat(formData.targetPrice),
      tolerancePct: parseFloat(formData.tolerancePct),
      volumeThresholdZScore: parseFloat(formData.volumeThresholdZScore),
      zScorePeriod: parseInt(formData.zScorePeriod),
      createdAt: alert?.createdAt || Date.now(),
    };

    onSave(alertData);
  };

  const handleDelete = () => {
    if (confirm("¿Estás seguro de que quieres eliminar esta alerta?")) {
      onDelete(alert.id);
    }
  };

  return (
    <div className="alert-config-modal-overlay" onClick={onClose}>
      <div className="alert-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? "Editar Alerta" : "Nueva Alerta"}</h2>
          <button className="btn-close" onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Nombre de la alerta */}
          <div className="form-group">
            <label htmlFor="name">Nombre de la Alerta *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Ej: BTC Support 95k"
              required
            />
          </div>

          {/* Símbolo */}
          <div className="form-group">
            <label htmlFor="symbol">Símbolo *</label>
            <select
              id="symbol"
              name="symbol"
              value={formData.symbol}
              onChange={handleInputChange}
              required
            >
              {symbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>

          {/* Fuente de referencia */}
          <div className="form-group">
            <label htmlFor="referenceSource">Fuente del Precio Objetivo</label>
            <select
              id="referenceSource"
              name="referenceSource"
              value={formData.referenceSource}
              onChange={handleInputChange}
            >
              <option value="manual">Manual</option>
              <option value="support_resistance">Support/Resistance</option>
              <option value="range_detector">Range Detector</option>
            </select>
          </div>

          {/* Selector de niveles si no es manual */}
          {formData.referenceSource !== "manual" && (
            <div className="form-group">
              <label>Seleccionar Nivel</label>
              {loadingLevels ? (
                <div className="loading-levels">Cargando niveles...</div>
              ) : (
                <div className="levels-selector">
                  {availableLevels.supports.length > 0 && (
                    <div className="levels-group">
                      <h4>Soportes</h4>
                      {availableLevels.supports.slice(0, 5).map((level, idx) => (
                        <button
                          key={`support-${idx}`}
                          type="button"
                          className={`level-option ${
                            formData.targetPrice === level.price ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleSelectLevel(level.price, "support", `support-${idx}`)
                          }
                        >
                          <span className="level-price">${level.price.toLocaleString()}</span>
                          <span className="level-strength">
                            Strength: {level.strength}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {availableLevels.resistances.length > 0 && (
                    <div className="levels-group">
                      <h4>Resistencias</h4>
                      {availableLevels.resistances.slice(0, 5).map((level, idx) => (
                        <button
                          key={`resistance-${idx}`}
                          type="button"
                          className={`level-option ${
                            formData.targetPrice === level.price ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleSelectLevel(level.price, "resistance", `resistance-${idx}`)
                          }
                        >
                          <span className="level-price">${level.price.toLocaleString()}</span>
                          <span className="level-strength">
                            Strength: {level.strength}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {availableLevels.supports.length === 0 &&
                    availableLevels.resistances.length === 0 && (
                      <div className="no-levels">
                        No se encontraron niveles. Usa precio manual.
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {/* Precio objetivo */}
          <div className="form-group">
            <label htmlFor="targetPrice">Precio Objetivo *</label>
            <input
              type="number"
              id="targetPrice"
              name="targetPrice"
              value={formData.targetPrice}
              onChange={handleInputChange}
              placeholder="95000"
              step="0.01"
              required
            />
          </div>

          {/* Tolerancia % */}
          <div className="form-group">
            <label htmlFor="tolerancePct">
              Tolerancia % <span className="help-text">(default: 1%)</span>
            </label>
            <input
              type="number"
              id="tolerancePct"
              name="tolerancePct"
              value={formData.tolerancePct}
              onChange={handleInputChange}
              step="0.1"
              min="0.1"
              max="10"
            />
          </div>

          {/* Umbral Z-Score Volumen */}
          <div className="form-group">
            <label htmlFor="volumeThresholdZScore">
              Umbral Z-Score Volumen <span className="help-text">(default: 2.0)</span>
            </label>
            <input
              type="number"
              id="volumeThresholdZScore"
              name="volumeThresholdZScore"
              value={formData.volumeThresholdZScore}
              onChange={handleInputChange}
              step="0.1"
              min="0.5"
              max="5"
            />
          </div>

          {/* Período Z-Score */}
          <div className="form-group">
            <label htmlFor="zScorePeriod">
              Período Z-Score <span className="help-text">(default: 50)</span>
            </label>
            <input
              type="number"
              id="zScorePeriod"
              name="zScorePeriod"
              value={formData.zScorePeriod}
              onChange={handleInputChange}
              min="10"
              max="200"
            />
          </div>

          {/* Habilitar/Deshabilitar */}
          <div className="form-group checkbox-group">
            <label htmlFor="enabled">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
                checked={formData.enabled}
                onChange={handleInputChange}
              />
              <span>Alerta Habilitada</span>
            </label>
          </div>

          {/* Botones de acción */}
          <div className="modal-actions">
            {isEditing && (
              <button type="button" className="btn-delete" onClick={handleDelete}>
                Eliminar
              </button>
            )}
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-save">
              {isEditing ? "Guardar Cambios" : "Crear Alerta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AlertConfigModal;
