import React, { useState, useEffect } from 'react';
import AlertProfileEditor from './AlertProfileEditor';
import './AlertConfigPanel.css';

/**
 * Alert Configuration Panel with Profile Management
 *
 * Manages multiple alert profiles with custom filters per indicator
 */
const AlertConfigPanel = ({ config, onConfigChange, onClose }) => {
  const [localConfig, setLocalConfig] = useState(config || getDefaultConfig());
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [isNewProfile, setIsNewProfile] = useState(false);

  const handleChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
  };

  const handleSave = () => {
    if (onConfigChange) {
      onConfigChange(localConfig);
    }
    onClose();
  };

  const handleCreateProfile = () => {
    setEditingProfile(null);
    setIsNewProfile(true);
    setShowProfileEditor(true);
  };

  const handleEditProfile = (profile) => {
    setEditingProfile(profile);
    setIsNewProfile(false);
    setShowProfileEditor(true);
  };

  const handleSaveProfile = (profile) => {
    let updatedProfiles;

    if (isNewProfile) {
      // Add new profile
      updatedProfiles = [...localConfig.profiles, profile];
    } else {
      // Update existing profile
      updatedProfiles = localConfig.profiles.map(p =>
        p.id === profile.id ? profile : p
      );
    }

    setLocalConfig({
      ...localConfig,
      profiles: updatedProfiles
    });

    setShowProfileEditor(false);
    setEditingProfile(null);
  };

  const handleDeleteProfile = (profileId) => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este perfil?')) {
      return;
    }

    const updatedProfiles = localConfig.profiles.filter(p => p.id !== profileId);

    // If deleting active profile, switch to first available or null
    let newActiveProfile = localConfig.activeProfileId;
    if (profileId === localConfig.activeProfileId) {
      newActiveProfile = updatedProfiles.length > 0 ? updatedProfiles[0].id : null;
    }

    setLocalConfig({
      ...localConfig,
      profiles: updatedProfiles,
      activeProfileId: newActiveProfile
    });
  };

  const handleSetActiveProfile = (profileId) => {
    setLocalConfig({
      ...localConfig,
      activeProfileId: profileId
    });
  };

  const getActiveProfile = () => {
    return localConfig.profiles.find(p => p.id === localConfig.activeProfileId);
  };

  const getDefaultProfiles = () => {
    return [
      {
        id: 'default_scalping',
        name: '⚡ Scalping Agresivo',
        description: 'Alertas en niveles fuertes con patrones de alta confianza',
        indicators: {
          'Support & Resistance': {
            enabled: true,
            minStrength: 8,
            proximityPercent: 0.2,
            minTouches: 2
          },
          'Rejection Patterns': {
            enabled: true,
            minConfidence: 75,
            requireNearLevel: true
          },
          'Volume Profile': {
            enabled: false,
            alertOnPOC: true,
            alertOnValueArea: false,
            proximityPercent: 0.3
          },
          'Open Interest': {
            enabled: false,
            minChangePercent: 20,
            lookbackCandles: 3
          },
          'Volume Delta': {
            enabled: false,
            minMultiplier: 2.0,
            lookbackPeriod: 20
          },
          'CVD': {
            enabled: false,
            alertOnExtremes: true,
            alertOnTrendChange: true,
            extremeThreshold: 0.05
          }
        },
        confluenceEnabled: true,
        minIndicatorsForConfluence: 2,
        confluenceWindowCandles: 2,
        confluencePriceProximity: 0.3
      },
      {
        id: 'default_swing',
        name: '📈 Swing Trading',
        description: 'Alertas balanceadas para posiciones de swing trading',
        indicators: {
          'Support & Resistance': {
            enabled: true,
            minStrength: 5,
            proximityPercent: 0.5,
            minTouches: 3
          },
          'Rejection Patterns': {
            enabled: true,
            minConfidence: 65,
            requireNearLevel: true
          },
          'Volume Profile': {
            enabled: true,
            alertOnPOC: true,
            alertOnValueArea: true,
            proximityPercent: 0.5
          },
          'Open Interest': {
            enabled: true,
            minChangePercent: 15,
            lookbackCandles: 5
          },
          'Volume': {
            enabled: true,
            minMultiplier: 2.0,
            lookbackPeriod: 20
          },
          'Volume Delta': {
            enabled: true,
            minMultiplier: 2.5,
            lookbackPeriod: 20
          },
          'CVD': {
            enabled: true,
            alertOnExtremes: true,
            alertOnTrendChange: true,
            extremeThreshold: 0.05
          }
        },
        confluenceEnabled: true,
        minIndicatorsForConfluence: 3,
        confluenceWindowCandles: 5,
        confluencePriceProximity: 0.5
      },
      {
        id: 'default_confluence',
        name: '🎯 Confluencias Extremas',
        description: 'Solo confluencias extremas de múltiples indicadores',
        indicators: {
          'Support & Resistance': {
            enabled: true,
            minStrength: 9,
            proximityPercent: 0.3,
            minTouches: 4
          },
          'Rejection Patterns': {
            enabled: true,
            minConfidence: 85,
            requireNearLevel: true
          },
          'Volume Profile': {
            enabled: true,
            alertOnPOC: true,
            alertOnValueArea: true,
            proximityPercent: 0.4
          },
          'Open Interest': {
            enabled: true,
            minChangePercent: 20,
            lookbackCandles: 5
          },
          'Volume': {
            enabled: true,
            minMultiplier: 2.5,
            lookbackPeriod: 20
          },
          'Volume Delta': {
            enabled: true,
            minMultiplier: 3.0,
            lookbackPeriod: 20
          },
          'CVD': {
            enabled: true,
            alertOnExtremes: true,
            alertOnTrendChange: true,
            extremeThreshold: 0.03
          }
        },
        confluenceEnabled: true,
        minIndicatorsForConfluence: 4,
        confluenceWindowCandles: 3,
        confluencePriceProximity: 0.5
      }
    ];
  };

  const activeProfile = getActiveProfile();

  return (
    <div className="alert-config-overlay" onClick={onClose}>
      <div className="alert-config-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="alert-config-header">
          <h3>⚙️ Configuración del Sistema de Alertas</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Content */}
        <div className="alert-config-content">
          {/* Section 1: Global Settings */}
          <section className="config-section">
            <h4>🔔 Configuración Global</h4>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.enabled}
                  onChange={(e) => handleChange('enabled', e.target.checked)}
                />
                <span>Activar Sistema de Alertas</span>
              </label>
              <span className="config-hint">Interruptor maestro para todas las alertas</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.soundEnabled}
                  onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Activar Notificaciones de Sonido</span>
              </label>
              <span className="config-hint">Reproducir sonido cuando llegue una alerta</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.browserNotifications}
                  onChange={(e) => handleChange('browserNotifications', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Activar Notificaciones del Navegador</span>
              </label>
              <span className="config-hint">Mostrar notificaciones nativas del navegador</span>
            </div>
          </section>

          {/* Section 2: Alert Profiles */}
          <section className="config-section">
            <div className="section-header-with-button">
              <h4>📊 Perfiles de Alertas</h4>
              <button className="btn-create-profile" onClick={handleCreateProfile}>
                ➕ Crear Nuevo Perfil
              </button>
            </div>
            <p className="section-description">
              Crea perfiles personalizados de alertas con filtros específicos para cada indicador. Cada perfil puede tener diferentes configuraciones y reglas de confluencia.
            </p>

            {localConfig.profiles.length === 0 ? (
              <div className="no-profiles">
                <p>No hay perfiles todavía. ¡Crea tu primer perfil de alertas!</p>
                <button className="btn-primary" onClick={handleCreateProfile}>
                  ➕ Crear Perfil
                </button>
              </div>
            ) : (
              <div className="profiles-list">
                {localConfig.profiles.map(profile => (
                  <div
                    key={profile.id}
                    className={`profile-card ${profile.id === localConfig.activeProfileId ? 'active' : ''}`}
                  >
                    <div className="profile-header">
                      <label className="profile-radio">
                        <input
                          type="radio"
                          name="activeProfile"
                          checked={profile.id === localConfig.activeProfileId}
                          onChange={() => handleSetActiveProfile(profile.id)}
                          disabled={!localConfig.enabled}
                        />
                        <span className="profile-name">{profile.name}</span>
                      </label>
                      <div className="profile-actions">
                        <button
                          className="btn-edit"
                          onClick={() => handleEditProfile(profile)}
                          title="Editar perfil"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteProfile(profile.id)}
                          title="Eliminar perfil"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {profile.description && (
                      <div className="profile-description">{profile.description}</div>
                    )}

                    <div className="profile-stats">
                      {Object.entries(profile.indicators).filter(([_, ind]) => ind.enabled).map(([name]) => (
                        <span key={name} className="indicator-badge">{name}</span>
                      ))}
                      {profile.confluenceEnabled && (
                        <span className="confluence-badge">
                          🎯 Confluence: {profile.minIndicatorsForConfluence}+
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Summary */}
          <section className="config-section summary">
            <h4>📋 Estado Actual</h4>
            <div className="summary-content">
              {!localConfig.enabled && (
                <p className="warning">⚠️ Sistema de alertas desactivado</p>
              )}
              {localConfig.enabled && !localConfig.activeProfileId && (
                <p className="warning">⚠️ No hay perfil activo - selecciona uno para recibir alertas</p>
              )}
              {localConfig.enabled && activeProfile && (
                <p className="success">
                  ✅ Perfil Activo: <strong>{activeProfile.name}</strong>
                </p>
              )}
              {localConfig.soundEnabled && (
                <p className="info">🔊 Notificaciones de sonido activadas</p>
              )}
              {localConfig.browserNotifications && (
                <p className="info">🌐 Notificaciones del navegador activadas</p>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="alert-config-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Guardar y Cerrar
          </button>
        </div>
      </div>

      {/* Profile Editor Modal */}
      {showProfileEditor && (
        <AlertProfileEditor
          profile={editingProfile}
          onSave={handleSaveProfile}
          onCancel={() => {
            setShowProfileEditor(false);
            setEditingProfile(null);
          }}
          isNew={isNewProfile}
        />
      )}
    </div>
  );
};

function getDefaultConfig() {
  const defaultProfiles = [
    {
      id: 'default_scalping',
      name: '⚡ Scalping Agresivo',
      description: 'Alertas en niveles fuertes con patrones de alta confianza',
      indicators: {
        'Support & Resistance': {
          enabled: true,
          minStrength: 8,
          proximityPercent: 0.2,
          minTouches: 2
        },
        'Rejection Patterns': {
          enabled: true,
          minConfidence: 75,
          requireNearLevel: true
        },
        'Volume Profile': {
          enabled: false,
          alertOnPOC: true,
          alertOnValueArea: false,
          proximityPercent: 0.3
        },
        'Open Interest': {
          enabled: false,
          minChangePercent: 20,
          lookbackCandles: 3
        },
        'Volume': {
          enabled: false,
          minMultiplier: 2.0,
          lookbackPeriod: 20
        },
        'Volume Delta': {
          enabled: false,
          minMultiplier: 2.0,
          lookbackPeriod: 20
        },
        'CVD': {
          enabled: false,
          alertOnExtremes: true,
          alertOnTrendChange: true,
          extremeThreshold: 0.05
        }
      },
      confluenceEnabled: true,
      minIndicatorsForConfluence: 2,
      confluenceWindowCandles: 2,
      confluencePriceProximity: 0.3
    }
  ];

  return {
    enabled: true,
    soundEnabled: false,
    browserNotifications: false,
    profiles: defaultProfiles,
    activeProfileId: 'default_scalping'
  };
}

export default AlertConfigPanel;
