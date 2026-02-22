/**
 * Settings Service
 * Handles user settings storage and retrieval
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getSettingsPath, getUserDataDir } from '../utils/helpers';

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
  weatherEnabled?: boolean;
  browserEnabled?: boolean;
  iMessageEnabled?: boolean;
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

  /**
   * Get iMessage integration enabled state for current user
   * Includes automatic migration for existing users with iMessage data
   * @param username - The username
   * @returns iMessage enabled status (defaults to false)
   */
  static async getIMessageEnabled(username: string | null | undefined): Promise<boolean> {
    try {
      if (!username) {
        return false; // Default to disabled when not logged in
      }

      const response = await this.getSettings(username);
      if (response.ok && response.settings) {
        // MIGRATION: If iMessageEnabled is undefined (old user), check if they have iMessage data
        if (response.settings.iMessageEnabled === undefined) {
          const hasExistingData = await this.checkExistingIMessageData(username);
          // Auto-enable for users with existing iMessage insights
          const migratedValue = hasExistingData;
          await this.updateSettings(username, { iMessageEnabled: migratedValue });
          console.log(`[Settings] Migrated iMessageEnabled for ${username}: ${migratedValue}`);
          return migratedValue;
        }
        return response.settings.iMessageEnabled ?? false;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if user has existing iMessage data (for migration)
   * @param username - The username
   * @returns True if user has existing iMessage insights
   */
  private static async checkExistingIMessageData(username: string): Promise<boolean> {
    try {
      const userDir = await getUserDataDir(username);
      const insightsDir = path.join(userDir, 'insights');

      // Check if insights directory exists
      try {
        await fs.access(insightsDir);
      } catch {
        return false; // No insights directory = no iMessage data
      }

      // Look for insight files with iMessage data
      const files = await fs.readdir(insightsDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(insightsDir, file);
          const content = await fs.readFile(filePath, 'utf8');

          // Check for iMessage or SMS platform references
          if (content.includes('"platform":"imessage"') || content.includes('"platform":"sms"')) {
            console.log(`[Settings] Found existing iMessage data in ${file}`);
            return true;
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      return false; // No iMessage data found
    } catch (error) {
      console.error('[Settings] Error checking existing iMessage data:', error);
      return false; // Default to disabled on error
    }
  }

  /**
   * Set iMessage integration enabled state for current user
   * @param username - The username
   * @param enabled - Enable or disable iMessage integration
   * @returns Success/error response
   */
  static async setIMessageEnabled(
    username: string | null | undefined,
    enabled: boolean
  ): Promise<SettingsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await this.updateSettings(username, { iMessageEnabled: enabled });
      if (result.ok) {
        console.log(`[Settings] iMessage integration ${enabled ? 'enabled' : 'disabled'}`);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }
}
