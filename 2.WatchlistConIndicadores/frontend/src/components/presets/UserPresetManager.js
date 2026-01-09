// src/components/presets/UserPresetManager.js

/**
 * User Preset Manager - Handles saving/loading custom user presets to localStorage
 */

const USER_PRESETS_KEY = 'continuation_pattern_user_presets';

/**
 * Get all user presets from localStorage
 */
export const getUserPresets = () => {
  try {
    const stored = localStorage.getItem(USER_PRESETS_KEY);
    if (!stored) return {};

    const presets = JSON.parse(stored);
    return presets || {};
  } catch (error) {
    console.error('[UserPresetManager] Error loading user presets:', error);
    return {};
  }
};

/**
 * Save a new user preset
 *
 * @param {string} presetName - Name for the preset (will be converted to key)
 * @param {object} config - Complete configuration object
 * @param {string} description - Optional description
 * @returns {boolean} Success status
 */
export const saveUserPreset = (presetName, config, description = '') => {
  try {
    if (!presetName || !presetName.trim()) {
      throw new Error('Preset name is required');
    }

    const userPresets = getUserPresets();

    // Generate safe key from name
    const presetKey = `user_${presetName.toLowerCase().replace(/\s+/g, '_')}`;

    // Check if preset already exists
    if (userPresets[presetKey]) {
      // Overwrite confirmation should be handled by UI
      console.warn(`[UserPresetManager] Preset "${presetName}" already exists, overwriting...`);
    }

    // Create preset object
    userPresets[presetKey] = {
      name: presetName,
      description: description || `Preset personalizado: ${presetName}`,
      config: config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to localStorage
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets));

    console.log(`[UserPresetManager] Saved user preset: ${presetName} (${presetKey})`);
    return true;
  } catch (error) {
    console.error('[UserPresetManager] Error saving user preset:', error);
    return false;
  }
};

/**
 * Delete a user preset
 *
 * @param {string} presetKey - Key of the preset to delete
 * @returns {boolean} Success status
 */
export const deleteUserPreset = (presetKey) => {
  try {
    if (!presetKey.startsWith('user_')) {
      throw new Error('Cannot delete predefined presets');
    }

    const userPresets = getUserPresets();

    if (!userPresets[presetKey]) {
      console.warn(`[UserPresetManager] Preset ${presetKey} not found`);
      return false;
    }

    delete userPresets[presetKey];

    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets));

    console.log(`[UserPresetManager] Deleted user preset: ${presetKey}`);
    return true;
  } catch (error) {
    console.error('[UserPresetManager] Error deleting user preset:', error);
    return false;
  }
};

/**
 * Get a specific user preset configuration
 *
 * @param {string} presetKey - Key of the preset
 * @returns {object|null} Preset config or null if not found
 */
export const getUserPresetConfig = (presetKey) => {
  const userPresets = getUserPresets();
  const preset = userPresets[presetKey];
  return preset ? preset.config : null;
};

/**
 * Get all user preset names for dropdown
 *
 * @returns {Array} Array of {key, name, description, isUserPreset}
 */
export const getUserPresetNames = () => {
  const userPresets = getUserPresets();

  return Object.keys(userPresets).map(key => ({
    key,
    name: userPresets[key].name,
    description: userPresets[key].description,
    isUserPreset: true,
    createdAt: userPresets[key].createdAt
  }));
};

/**
 * Check if a preset key is a user preset
 *
 * @param {string} presetKey
 * @returns {boolean}
 */
export const isUserPreset = (presetKey) => {
  return presetKey.startsWith('user_');
};

/**
 * Export all user presets as JSON (for backup)
 *
 * @returns {string} JSON string of all user presets
 */
export const exportUserPresets = () => {
  const userPresets = getUserPresets();
  return JSON.stringify(userPresets, null, 2);
};

/**
 * Import user presets from JSON (for restore)
 *
 * @param {string} jsonString - JSON string of presets
 * @returns {boolean} Success status
 */
export const importUserPresets = (jsonString) => {
  try {
    const presets = JSON.parse(jsonString);

    // Validate structure
    if (typeof presets !== 'object') {
      throw new Error('Invalid preset format');
    }

    // Merge with existing presets (or replace if you prefer)
    const existingPresets = getUserPresets();
    const mergedPresets = { ...existingPresets, ...presets };

    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(mergedPresets));

    console.log('[UserPresetManager] Imported user presets successfully');
    return true;
  } catch (error) {
    console.error('[UserPresetManager] Error importing presets:', error);
    return false;
  }
};

/**
 * Clear all user presets (with confirmation in UI)
 *
 * @returns {boolean} Success status
 */
export const clearAllUserPresets = () => {
  try {
    localStorage.removeItem(USER_PRESETS_KEY);
    console.log('[UserPresetManager] Cleared all user presets');
    return true;
  } catch (error) {
    console.error('[UserPresetManager] Error clearing presets:', error);
    return false;
  }
};
