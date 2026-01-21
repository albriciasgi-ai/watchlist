import React, { useState, useEffect } from 'react';

/**
 * DTB Profiles Manager
 * Sistema de perfiles/presets optimizados para Double Top/Bottom
 * Basado en las simulaciones realizadas
 */

// Perfiles optimizados basados en simulaciones
const OPTIMIZED_PROFILES = {
  '1min_aggressive': {
    name: '1 Min - Agresivo (10+ patrones)',
    description: 'Máxima detección para scalping en 1 minuto',
    timeframes: ['1'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 30,
        candlesPerExtreme: 2,
        priceMarginPercent: 10.0,  // 10% tolerancia
        minCandlesBetween: 1,
        maxCandlesBetween: 150,
        maxBreakoutPercent: 50,  // Muy permisivo
        lookbackBars: 2,
        minBarsBetween: 1,
        patternTimeLimit: 2000,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 50,  // Filtro medio para evitar ruido
        requireBothRejections: false,
        minPatternDuration: 0.1,
        maxPatternDuration: 4,
        postPatternValidationCandles: 3,
        duplicatePriceTolerancePercent: 1.0,
        duplicateTimeToleranceHours: 1
      },
      postValidation: { enabled: false }
    }
  },

  '1min_balanced': {
    name: '1 Min - Balanceado (8 patrones)',
    description: 'Balance entre detección y calidad para 1 minuto',
    timeframes: ['1'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 30,
        candlesPerExtreme: 2,
        priceMarginPercent: 7.0,
        minCandlesBetween: 2,
        maxCandlesBetween: 120,
        maxBreakoutPercent: 30,
        lookbackBars: 2,
        minBarsBetween: 2,
        patternTimeLimit: 1500,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 70,
        requireBothRejections: false,
        minPatternDuration: 0.1,
        maxPatternDuration: 3,
        postPatternValidationCandles: 3,
        duplicatePriceTolerancePercent: 0.8,
        duplicateTimeToleranceHours: 1
      },
      postValidation: { enabled: false }
    }
  },

  '1min_conservative': {
    name: '1 Min - Conservador (4-5 patrones)',
    description: 'Alta calidad, menos señales falsas',
    timeframes: ['1'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 20,
        candlesPerExtreme: 3,
        priceMarginPercent: 5.0,
        minCandlesBetween: 3,
        maxCandlesBetween: 100,
        maxBreakoutPercent: 20,
        lookbackBars: 3,
        minBarsBetween: 3,
        patternTimeLimit: 1000,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 80,
        requireBothRejections: false,
        minPatternDuration: 0.2,
        maxPatternDuration: 2,
        postPatternValidationCandles: 5,
        duplicatePriceTolerancePercent: 0.5,
        duplicateTimeToleranceHours: 0.5
      },
      postValidation: { enabled: false }
    }
  },

  '5min_optimized': {
    name: '5 Min - Optimizado',
    description: 'Configuración optimizada para 5 minutos',
    timeframes: ['5'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 50,
        candlesPerExtreme: 3,
        priceMarginPercent: 6.0,
        minCandlesBetween: 2,
        maxCandlesBetween: 100,
        maxBreakoutPercent: 25,
        lookbackBars: 3,
        minBarsBetween: 2,
        patternTimeLimit: 1200,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 65,
        requireBothRejections: false,
        minPatternDuration: 0.5,
        maxPatternDuration: 12,
        postPatternValidationCandles: 4,
        duplicatePriceTolerancePercent: 1.5,
        duplicateTimeToleranceHours: 3
      },
      postValidation: { enabled: false }
    }
  },

  '15min_standard': {
    name: '15 Min - Estándar',
    description: 'Configuración estándar para 15 minutos',
    timeframes: ['15'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 80,
        candlesPerExtreme: 4,
        priceMarginPercent: 4.0,
        minCandlesBetween: 3,
        maxCandlesBetween: 80,
        maxBreakoutPercent: 15,
        lookbackBars: 5,
        minBarsBetween: 3,
        patternTimeLimit: 800,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 70,
        requireBothRejections: false,
        minPatternDuration: 1,
        maxPatternDuration: 24,
        postPatternValidationCandles: 5,
        duplicatePriceTolerancePercent: 2.0,
        duplicateTimeToleranceHours: 6
      },
      postValidation: { enabled: false }
    }
  },

  '1h_standard': {
    name: '1 Hora - Estándar',
    description: 'Configuración estándar para 1 hora',
    timeframes: ['60'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 100,
        candlesPerExtreme: 5,
        priceMarginPercent: 3.0,
        minCandlesBetween: 3,
        maxCandlesBetween: 80,
        maxBreakoutPercent: 10,
        lookbackBars: 10,
        minBarsBetween: 5,
        patternTimeLimit: 500,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: false }
      },
      momentumConfirmation: { enabled: false },
      filters: {
        minConfidence: 75,
        requireBothRejections: false,
        minPatternDuration: 3,
        maxPatternDuration: 168,
        postPatternValidationCandles: 5,
        duplicatePriceTolerancePercent: 2.5,
        duplicateTimeToleranceHours: 24
      },
      postValidation: { enabled: false }
    }
  },

  '4h_swing': {
    name: '4 Horas - Swing Trading',
    description: 'Para operaciones de swing trading',
    timeframes: ['240'],
    config: {
      doubleTopBottom: {
        lookbackCandles: 100,
        candlesPerExtreme: 5,
        priceMarginPercent: 3.0,
        minCandlesBetween: 5,
        maxCandlesBetween: 60,
        maxBreakoutPercent: 7,
        lookbackBars: 10,
        minBarsBetween: 5,
        patternTimeLimit: 300,
        volumeFilter: { enabled: false },
        requireHighVolumeAtExtremes: { enabled: true, zScoreThresholdFirst: 1.5, zScoreThresholdSecond: 0.5 }
      },
      momentumConfirmation: { enabled: true },
      filters: {
        minConfidence: 80,
        requireBothRejections: true,
        minPatternDuration: 12,
        maxPatternDuration: 720,
        postPatternValidationCandles: 5,
        duplicatePriceTolerancePercent: 3.0,
        duplicateTimeToleranceHours: 48
      },
      postValidation: { enabled: true }
    }
  }
};

const DTBProfilesManager = ({
  currentConfig,
  onProfileSelect,
  currentTimeframe,
  symbol
}) => {
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [customProfiles, setCustomProfiles] = useState({});
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileDescription, setProfileDescription] = useState('');

  useEffect(() => {
    // Cargar perfiles personalizados desde localStorage
    const savedProfiles = localStorage.getItem(`dtb_custom_profiles_${symbol}`);
    if (savedProfiles) {
      try {
        setCustomProfiles(JSON.parse(savedProfiles));
      } catch (e) {
        console.error('Error loading custom profiles:', e);
      }
    }
  }, [symbol]);

  const handleProfileSelect = (profileId) => {
    const profile = OPTIMIZED_PROFILES[profileId] || customProfiles[profileId];
    if (profile) {
      setSelectedProfile(profileId);
      onProfileSelect(profile.config);
    }
  };

  const saveCustomProfile = () => {
    if (!profileName.trim()) return;

    const newProfile = {
      name: profileName,
      description: profileDescription || 'Perfil personalizado',
      timeframes: [currentTimeframe],
      config: currentConfig,
      createdAt: new Date().toISOString()
    };

    const profileId = `custom_${Date.now()}`;
    const updatedProfiles = {
      ...customProfiles,
      [profileId]: newProfile
    };

    setCustomProfiles(updatedProfiles);
    localStorage.setItem(`dtb_custom_profiles_${symbol}`, JSON.stringify(updatedProfiles));

    setShowSaveDialog(false);
    setProfileName('');
    setProfileDescription('');
  };

  const deleteCustomProfile = (profileId) => {
    const updatedProfiles = { ...customProfiles };
    delete updatedProfiles[profileId];
    setCustomProfiles(updatedProfiles);
    localStorage.setItem(`dtb_custom_profiles_${symbol}`, JSON.stringify(updatedProfiles));
  };

  // Filtrar perfiles por timeframe actual
  const availableProfiles = Object.entries(OPTIMIZED_PROFILES)
    .filter(([_, profile]) =>
      !profile.timeframes ||
      profile.timeframes.includes(currentTimeframe) ||
      profile.timeframes.includes('*')
    );

  const customProfilesList = Object.entries(customProfiles);

  return (
    <div className="dtb-profiles-manager">
      <div style={{
        padding: '12px',
        backgroundColor: '#f8f8f8',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#333' }}>
          Perfiles Optimizados DTB
        </h3>

        {/* Perfiles predefinidos */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{ fontSize: '12px', color: '#666', margin: '0 0 8px 0' }}>
            Perfiles Recomendados:
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {availableProfiles.map(([id, profile]) => (
              <button
                key={id}
                onClick={() => handleProfileSelect(id)}
                style={{
                  padding: '6px 12px',
                  fontSize: '11px',
                  backgroundColor: selectedProfile === id ? '#4CAF50' : '#fff',
                  color: selectedProfile === id ? '#fff' : '#333',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                title={profile.description}
              >
                {profile.name}
              </button>
            ))}
          </div>
        </div>

        {/* Perfiles personalizados */}
        {customProfilesList.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ fontSize: '12px', color: '#666', margin: '0 0 8px 0' }}>
              Perfiles Personalizados:
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {customProfilesList.map(([id, profile]) => (
                <div key={id} style={{ position: 'relative' }}>
                  <button
                    onClick={() => handleProfileSelect(id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '11px',
                      backgroundColor: selectedProfile === id ? '#2196F3' : '#fff',
                      color: selectedProfile === id ? '#fff' : '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                    title={profile.description}
                  >
                    {profile.name}
                  </button>
                  <button
                    onClick={() => deleteCustomProfile(id)}
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '16px',
                      height: '16px',
                      backgroundColor: '#f44336',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '50%',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botón guardar perfil actual */}
        <button
          onClick={() => setShowSaveDialog(true)}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: '#FF9800',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '8px'
          }}
        >
          💾 Guardar Config Actual como Perfil
        </button>

        {/* Diálogo para guardar perfil */}
        {showSaveDialog && (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#fff',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            zIndex: 9999,
            minWidth: '300px'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>
              Guardar Perfil Personalizado
            </h3>

            <input
              type="text"
              placeholder="Nombre del perfil"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
            />

            <textarea
              placeholder="Descripción (opcional)"
              value={profileDescription}
              onChange={(e) => setProfileDescription(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                minHeight: '60px'
              }}
            />

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSaveDialog(false)}
                style={{
                  padding: '6px 16px',
                  backgroundColor: '#ddd',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={saveCustomProfile}
                disabled={!profileName.trim()}
                style={{
                  padding: '6px 16px',
                  backgroundColor: profileName.trim() ? '#4CAF50' : '#ccc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: profileName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .dtb-profiles-manager button:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      `}</style>
    </div>
  );
};

export default DTBProfilesManager;