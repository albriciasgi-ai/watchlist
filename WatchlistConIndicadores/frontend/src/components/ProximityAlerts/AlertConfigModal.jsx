// src/components/ProximityAlerts/AlertConfigModal.jsx
import React, { useState, useEffect } from "react";
import "./AlertConfigModal.css";

/**
 * AlertConfigModal - Modal para configurar alertas de proximidad
 *
 * Permite:
 * - Crear nueva alerta
 * - Editar alerta existente
 * - Seleccionar precio manual o desde S/R / Range Detector
 * - Configurar tolerancia y umbral de volumen
 */
const AlertConfigModal = ({ alert, symbols, indicatorManagers = {}, onSave, onDelete, onClose }) => {
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

  // Estado para niveles de S/R, Range Detector y Volume Profile
  const [loadingLevels, setLoadingLevels] = useState(false);
  const [availableLevels, setAvailableLevels] = useState({
    supports: [],
    resistances: [],
    ranges: [],
    volumeProfile: [], // POC, VAH, VAL del VP dinámico y Fixed Ranges
  });

  // Cargar niveles cuando cambia el símbolo o la fuente de referencia
  useEffect(() => {
    if (formData.referenceSource !== "manual" && formData.symbol) {
      loadAvailableLevels();
    }
  }, [formData.symbol, formData.referenceSource, indicatorManagers]);

  const loadAvailableLevels = async () => {
    setLoadingLevels(true);
    try {
      console.log('[AlertConfigModal] Loading levels for:', {
        symbol: formData.symbol,
        referenceSource: formData.referenceSource,
        indicatorManagers: Object.keys(indicatorManagers)
      });

      const manager = indicatorManagers[formData.symbol]?.manager;

      if (!manager) {
        console.warn('[AlertConfigModal] No se encontró IndicatorManager para', formData.symbol);
        console.log('[AlertConfigModal] Available managers:', Object.keys(indicatorManagers));
        setAvailableLevels({ supports: [], resistances: [], ranges: [], volumeProfile: [] });
        setLoadingLevels(false);
        return;
      }

      console.log('[AlertConfigModal] Manager found:', manager);

      if (formData.referenceSource === "support_resistance") {
        // Cargar niveles de Support & Resistance Indicator
        const srIndicator = manager.supportResistanceIndicator;

        console.log('[AlertConfigModal] S/R Indicator:', {
          exists: !!srIndicator,
          enabled: srIndicator?.enabled,
          supports: srIndicator?.supports?.length,
          resistances: srIndicator?.resistances?.length
        });

        if (!srIndicator || !srIndicator.enabled) {
          console.warn('[AlertConfigModal] Support & Resistance Indicator no está activo');
          setAvailableLevels({ supports: [], resistances: [], ranges: [], volumeProfile: [] });
          setLoadingLevels(false);
          return;
        }

        // Leer los niveles directamente del indicador
        const supports = (srIndicator.supports || []).map((level, idx) => ({
          price: level.price,
          strength: level.strength || 1,
          id: `support-${idx}`,
          touches: level.touches,
          status: level.status
        }));

        const resistances = (srIndicator.resistances || []).map((level, idx) => ({
          price: level.price,
          strength: level.strength || 1,
          id: `resistance-${idx}`,
          touches: level.touches,
          status: level.status
        }));

        // Ordenar por strength (más fuerte primero)
        supports.sort((a, b) => b.strength - a.strength);
        resistances.sort((a, b) => b.strength - a.strength);

        setAvailableLevels({
          supports,
          resistances,
          ranges: [],
          volumeProfile: [],
        });

        console.log('[AlertConfigModal] S/R Levels loaded:', {
          supports: supports.length,
          resistances: resistances.length
        });

      } else if (formData.referenceSource === "range_detector") {
        // Cargar niveles de Range Detector
        const detector = manager.rangeDetector;

        if (!detector || !detector.enabled) {
          console.warn('[AlertConfigModal] Range Detector no está activo');
          setAvailableLevels({ supports: [], resistances: [], ranges: [], volumeProfile: [] });
          setLoadingLevels(false);
          return;
        }

        const ranges = detector.detectedRanges || [];

        // Convertir rangos a niveles de soporte/resistencia
        const supports = ranges.map((range, idx) => ({
          price: range.low,
          strength: 2,
          id: `range-low-${idx}`,
          rangeId: range.id,
          timestamp: range.startTimestamp
        }));

        const resistances = ranges.map((range, idx) => ({
          price: range.high,
          strength: 2,
          id: `range-high-${idx}`,
          rangeId: range.id,
          timestamp: range.startTimestamp
        }));

        supports.sort((a, b) => b.price - a.price);
        resistances.sort((a, b) => b.price - a.price);

        setAvailableLevels({
          supports,
          resistances,
          ranges,
          volumeProfile: [],
        });

        console.log('[AlertConfigModal] Range Detector levels loaded:', {
          supports: supports.length,
          resistances: resistances.length,
          ranges: ranges.length
        });

      } else if (formData.referenceSource === "volume_profile") {
        // Cargar niveles de Volume Profile (POC, VAH, VAL)
        const vpIndicator = manager.getVolumeProfileIndicator();

        console.log('[AlertConfigModal] VP Indicator:', {
          managerHasMethod: typeof manager.getVolumeProfileIndicator === 'function',
          exists: !!vpIndicator,
          enabled: vpIndicator?.enabled,
          poc: vpIndicator?.poc,
          vah: vpIndicator?.vah,
          val: vpIndicator?.val
        });

        if (!vpIndicator || !vpIndicator.enabled) {
          console.warn('[AlertConfigModal] Volume Profile no está activo');
          setAvailableLevels({ supports: [], resistances: [], ranges: [], volumeProfile: [] });
          setLoadingLevels(false);
          return;
        }

        const volumeProfile = [];

        // Agregar POC, VAH, VAL del Volume Profile dinámico
        if (vpIndicator.poc !== undefined && vpIndicator.poc !== null) {
          volumeProfile.push({
            price: vpIndicator.poc,
            type: 'POC',
            label: 'POC (Point of Control)',
            id: 'vp-poc',
            strength: 3,
          });
        }

        if (vpIndicator.vah !== undefined && vpIndicator.vah !== null) {
          volumeProfile.push({
            price: vpIndicator.vah,
            type: 'VAH',
            label: 'VAH (Value Area High)',
            id: 'vp-vah',
            strength: 2,
          });
        }

        if (vpIndicator.val !== undefined && vpIndicator.val !== null) {
          volumeProfile.push({
            price: vpIndicator.val,
            type: 'VAL',
            label: 'VAL (Value Area Low)',
            id: 'vp-val',
            strength: 2,
          });
        }

        // Ordenar por precio (descendente)
        volumeProfile.sort((a, b) => b.price - a.price);

        setAvailableLevels({
          supports: [],
          resistances: [],
          ranges: [],
          volumeProfile,
        });

        console.log('[AlertConfigModal] Volume Profile levels loaded:', {
          volumeProfile: volumeProfile.length
        });

      } else if (formData.referenceSource === "volume_profile_fixed") {
        // Cargar niveles de Fixed Ranges (POCs)
        const fixedRangeIndicators = manager.fixedRangeIndicators || [];

        console.log('[AlertConfigModal] Fixed Ranges:', {
          exists: !!manager.fixedRangeIndicators,
          count: fixedRangeIndicators.length
        });

        if (fixedRangeIndicators.length === 0) {
          console.warn('[AlertConfigModal] No hay Fixed Ranges configurados');
          setAvailableLevels({ supports: [], resistances: [], ranges: [], volumeProfile: [] });
          setLoadingLevels(false);
          return;
        }

        const volumeProfile = [];

        fixedRangeIndicators.forEach((fixedRange, idx) => {
          if (fixedRange.poc !== undefined && fixedRange.poc !== null) {
            const label = fixedRange.rangeLabel || `Range ${idx + 1}`;
            volumeProfile.push({
              price: fixedRange.poc,
              type: 'Fixed POC',
              label: `${label} POC`,
              id: `fixed-poc-${idx}`,
              strength: 2,
              rangeId: fixedRange.rangeId,
            });
          }
        });

        // Ordenar por precio (descendente)
        volumeProfile.sort((a, b) => b.price - a.price);

        setAvailableLevels({
          supports: [],
          resistances: [],
          ranges: [],
          volumeProfile,
        });

        console.log('[AlertConfigModal] Fixed Range POCs loaded:', {
          volumeProfile: volumeProfile.length
        });
      }
    } catch (error) {
      console.error("Error loading levels:", error);
      setAvailableLevels({
        supports: [],
        resistances: [],
        ranges: [],
        volumeProfile: [],
      });
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
              <option value="support_resistance">Support & Resistance</option>
              <option value="range_detector">Range Detector</option>
              <option value="volume_profile">Volume Profile (POC/VAH/VAL)</option>
              <option value="volume_profile_fixed">Volume Profile Fixed Ranges (POCs)</option>
            </select>
            <small style={{ color: '#888', fontSize: '11px', marginTop: '4px', display: 'block' }}>
              Nota: El indicador seleccionado debe estar activo en el símbolo
            </small>
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

                  {availableLevels.volumeProfile && availableLevels.volumeProfile.length > 0 && (
                    <div className="levels-group">
                      <h4>Volume Profile</h4>
                      {availableLevels.volumeProfile.map((level, idx) => (
                        <button
                          key={`vp-${idx}`}
                          type="button"
                          className={`level-option ${
                            formData.targetPrice === level.price ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleSelectLevel(level.price, level.type, level.id)
                          }
                        >
                          <span className="level-price">${level.price.toLocaleString()}</span>
                          <span className="level-label">{level.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {availableLevels.supports.length === 0 &&
                    availableLevels.resistances.length === 0 &&
                    availableLevels.volumeProfile.length === 0 && (
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
