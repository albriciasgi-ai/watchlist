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
    if (!window.confirm('Are you sure you want to delete this profile?')) {
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
        description: 'Alerts on strong levels with high confidence patterns',
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
        description: 'Balanced alerts for swing trading positions',
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
        description: 'Only extreme multi-indicator confluence',
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
          <h3>⚙️ Alert System Configuration</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Content */}
        <div className="alert-config-content">
          {/* Section 1: Global Settings */}
          <section className="config-section">
            <h4>🔔 Global Settings</h4>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.enabled}
                  onChange={(e) => handleChange('enabled', e.target.checked)}
                />
                <span>Enable Alert System</span>
              </label>
              <span className="config-hint">Master switch for all alerts</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.soundEnabled}
                  onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Enable Sound Notifications</span>
              </label>
              <span className="config-hint">Play sound when alert arrives</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.browserNotifications}
                  onChange={(e) => handleChange('browserNotifications', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Enable Browser Notifications</span>
              </label>
              <span className="config-hint">Show native browser notifications</span>
            </div>
          </section>

          {/* Section 2: Alert Profiles */}
          <section className="config-section">
            <div className="section-header-with-button">
              <h4>📊 Alert Profiles</h4>
              <button className="btn-create-profile" onClick={handleCreateProfile}>
                ➕ Create New Profile
              </button>
            </div>
            <p className="section-description">
              Create custom alert profiles with specific filters for each indicator. Each profile can have different settings and confluence rules.
            </p>

            {localConfig.profiles.length === 0 ? (
              <div className="no-profiles">
                <p>No profiles yet. Create your first alert profile!</p>
                <button className="btn-primary" onClick={handleCreateProfile}>
                  ➕ Create Profile
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
                          title="Edit profile"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteProfile(profile.id)}
                          title="Delete profile"
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
            <h4>📋 Current Status</h4>
            <div className="summary-content">
              {!localConfig.enabled && (
                <p className="warning">⚠️ Alert system is disabled</p>
              )}
              {localConfig.enabled && !localConfig.activeProfileId && (
                <p className="warning">⚠️ No active profile - select one to receive alerts</p>
              )}
              {localConfig.enabled && activeProfile && (
                <p className="success">
                  ✅ Active Profile: <strong>{activeProfile.name}</strong>
                </p>
              )}
              {localConfig.soundEnabled && (
                <p className="info">🔊 Sound notifications enabled</p>
              )}
              {localConfig.browserNotifications && (
                <p className="info">🌐 Browser notifications enabled</p>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="alert-config-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save & Close
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
      description: 'Alerts on strong levels with high confidence patterns',
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
