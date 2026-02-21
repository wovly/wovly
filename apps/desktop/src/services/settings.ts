/**
 * Settings Service
 * Handles user settings storage and retrieval
 */

import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

/**
 * User settings schema
 */
export interface UserSettings {
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
  activeProvider?: 'anthropic' | 'openai' | 'google';
  theme?: 'light' | 'dark' | 'auto';
  [key: string]: unknown; // Allow additional settings
}

/**
 * Settings service response
 */
export interface SettingsResponse {
  ok: boolean;
  settings?: UserSettings;
  error?: string;
}

/**
 * SettingsService - Manages user settings
 */
export class SettingsService {
  /**
   * Get user settings
   * @param username - The username to get settings for
   * @returns Settings object or empty if not found
   */
  static async getSettings(username: string | null | undefined): Promise<SettingsResponse> {
    try {
      if (!username) {
        return { ok: true, settings: {} };
      }

      const settingsPath = await getSettingsPath(username);
      const data = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(data) as UserSettings;

      return { ok: true, settings };
    } catch {
      // Return empty settings if file doesn't exist or parse error
      return { ok: true, settings: {} };
    }
  }

  /**
   * Update user settings (merge with existing)
   * @param username - The username to update settings for
   * @param newSettings - Settings to merge with existing
   * @returns Success/error response
   */
  static async updateSettings(
    username: string | null | undefined,
    newSettings: Partial<UserSettings>
  ): Promise<SettingsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const settingsPath = await getSettingsPath(username);

      // Load existing settings
      let existing: UserSettings = {};
      try {
        const data = await fs.readFile(settingsPath, 'utf8');
        existing = JSON.parse(data) as UserSettings;
      } catch {
        // No existing settings, start fresh
      }

      // Validate settings (basic validation)
      const validated = this.validateSettings(newSettings);
      if (!validated.ok) {
        return validated;
      }

      // Merge and save
      const merged: UserSettings = { ...existing, ...newSettings };
      await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Validate settings before saving
   * @param settings - Settings to validate
   * @returns Validation result
   */
  private static validateSettings(settings: Partial<UserSettings>): SettingsResponse {
    // Validate activeProvider if present
    if (settings.activeProvider) {
      const validProviders = ['anthropic', 'openai', 'google'];
      if (!validProviders.includes(settings.activeProvider)) {
        return {
          ok: false,
          error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
        };
      }
    }

    // Validate theme if present
    if (settings.theme) {
      const validThemes = ['light', 'dark', 'auto'];
      if (!validThemes.includes(settings.theme)) {
        return {
          ok: false,
          error: `Invalid theme. Must be one of: ${validThemes.join(', ')}`
        };
      }
    }

    // Validate API keys structure if present
    if (settings.apiKeys) {
      const { apiKeys } = settings;
      if (typeof apiKeys !== 'object' || apiKeys === null) {
        return { ok: false, error: 'apiKeys must be an object' };
      }

      // Check each key is a string
      for (const [provider, key] of Object.entries(apiKeys)) {
        if (key !== undefined && typeof key !== 'string') {
          return { ok: false, error: `API key for ${provider} must be a string` };
        }
      }
    }

    return { ok: true };
  }

  /**
   * Set a specific setting value
   * @param username - The username
   * @param key - Setting key
   * @param value - Setting value
   * @returns Success/error response
   */
  static async setSetting(
    username: string | null | undefined,
    key: string,
    value: unknown
  ): Promise<SettingsResponse> {
    return this.updateSettings(username, { [key]: value });
  }

  /**
   * Get a specific setting value
   * @param username - The username
   * @param key - Setting key
   * @returns The setting value or undefined
   */
  static async getSetting(
    username: string | null | undefined,
    key: string
  ): Promise<unknown> {
    const response = await this.getSettings(username);
    if (response.ok && response.settings) {
      return response.settings[key];
    }
    return undefined;
  }
}
