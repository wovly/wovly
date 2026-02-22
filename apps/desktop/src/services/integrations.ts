/**
 * Integrations Service
 * Handles integration testing and enable/disable flags
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import helper functions
import { getSettingsPath } from '../utils/helpers';
import { SettingsService } from './settings';

/**
 * Service response interface
 */
export interface IntegrationsResponse {
  ok: boolean;
  message?: string;
  enabled?: boolean;
  error?: string;
}

/**
 * IntegrationsService - Manages integration testing and settings
 */
export class IntegrationsService {
  /**
   * Test Google integration (OAuth + Calendar access)
   * @param getGoogleAccessToken - Function to get Google access token
   * @param username - Current username
   * @returns Test result with connection status
   */
  static async testGoogle(
    getGoogleAccessToken: (username: string | undefined) => Promise<string | null>,
    username: string | undefined
  ): Promise<IntegrationsResponse> {
    try {
      const accessToken = await getGoogleAccessToken(username);
      if (!accessToken) {
        return { ok: false, error: 'Not authorized' };
      }

      // Test basic connection
      const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        return { ok: false, error: 'Failed to verify connection' };
      }

      const userInfo: any = await response.json();

      // Also test calendar access specifically
      const calendarTestUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary');
      const calendarResponse = await fetch(calendarTestUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!calendarResponse.ok) {
        const errorText = await calendarResponse.text();
        console.error('[Google] Calendar test failed:', errorText);

        if (calendarResponse.status === 403) {
          return {
            ok: false,
            error: `Connected as ${userInfo.email}, but Calendar access denied. Please: 1) Enable Google Calendar API in your Google Cloud Console, 2) Disconnect and reconnect Google to grant calendar permissions.`
          };
        }

        return {
          ok: false,
          error: `Connected as ${userInfo.email}, but Calendar API error: ${calendarResponse.status}`
        };
      }

      return { ok: true, message: `Connected as ${userInfo.email} (Calendar: ✓)` };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Test iMessage integration (macOS only)
   * @returns Test result with database accessibility status
   */
  static async testIMessage(): Promise<IntegrationsResponse> {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'iMessage is only available on macOS' };
    }

    const dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    try {
      await fs.access(dbPath);
      return { ok: true, message: 'iMessage database accessible' };
    } catch {
      // Detect if running in development (via terminal/npm) vs production (packaged app)
      const isDev = !require('electron').app.isPackaged;
      const appName = isDev ? 'Terminal (or your terminal app)' : 'Wovly';

      return {
        ok: false,
        error: `Cannot access Messages database. Grant Full Disk Access to ${appName} in System Settings > Privacy & Security > Full Disk Access.`
      };
    }
  }

  /**
   * Enable iMessage integration for current user
   * @param username - Current username
   * @returns Success/error response
   */
  static async enableIMessage(username: string | null | undefined): Promise<IntegrationsResponse> {
    // First test if iMessage is accessible
    const testResult = await this.testIMessage();
    if (!testResult.ok) {
      return testResult; // Return error if database not accessible
    }

    // Enable in settings
    const settingsResult = await SettingsService.setIMessageEnabled(username, true);
    if (!settingsResult.ok) {
      return { ok: false, error: settingsResult.error };
    }

    return {
      ok: true,
      message: 'iMessage integration enabled successfully'
    };
  }

  /**
   * Disable iMessage integration for current user
   * @param username - Current username
   * @returns Success/error response
   */
  static async disableIMessage(username: string | null | undefined): Promise<IntegrationsResponse> {
    const settingsResult = await SettingsService.setIMessageEnabled(username, false);
    if (!settingsResult.ok) {
      return { ok: false, error: settingsResult.error };
    }

    return {
      ok: true,
      message: 'iMessage integration disabled'
    };
  }

  /**
   * Get iMessage integration status for current user
   * @param username - Current username
   * @returns Status object with enabled and accessible flags
   */
  static async getIMessageStatus(username: string | null | undefined): Promise<{
    enabled: boolean;
    accessible: boolean;
    error?: string;
  }> {
    const enabled = await SettingsService.getIMessageEnabled(username);
    const testResult = await this.testIMessage();

    return {
      enabled,
      accessible: testResult.ok,
      error: testResult.ok ? undefined : testResult.error
    };
  }

  /**
   * Test Weather integration (Open-Meteo API)
   * @returns Test result with sample weather data
   */
  static async testWeather(): Promise<IntegrationsResponse> {
    try {
      // Test Open-Meteo API with a simple location query
      const response = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m&timezone=auto'
      );

      if (response.ok) {
        const data: any = await response.json();
        const temp = Math.round(data.current.temperature_2m * (9 / 5) + 32); // Convert to F
        return { ok: true, message: `Weather API connected. Current: ${temp}°F in NYC` };
      }

      return { ok: false, error: 'Failed to connect to weather API' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Test Browser integration (CDP)
   * @param getBrowserController - Function to get browser controller
   * @param username - Current username
   * @returns Test result with browser accessibility status
   */
  static async testBrowser(
    getBrowserController: (username: string) => Promise<any>,
    username: string | null | undefined
  ): Promise<IntegrationsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const controller = await getBrowserController(username);
      const snapshot = await controller.navigate('test', 'https://example.com');

      // Clean up test session
      const { context } = controller.contexts.get('test') || {};
      if (context) {
        await context.close();
        controller.contexts.delete('test');
      }

      if (snapshot?.title) {
        return { ok: true, message: `Browser automation working. Visited: ${snapshot.title}` };
      }

      return { ok: true, message: 'Browser automation is working' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Test Slack integration
   * @param getSlackAccessToken - Function to get Slack access token
   * @param username - Current username
   * @returns Test result with Slack connection status
   */
  static async testSlack(
    getSlackAccessToken: (username: string | undefined) => Promise<string | null>,
    username: string | undefined
  ): Promise<IntegrationsResponse> {
    try {
      const accessToken = await getSlackAccessToken(username);
      if (!accessToken) {
        return { ok: false, error: 'Not authorized' };
      }

      const response = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data: any = await response.json();

      if (data.ok) {
        return { ok: true, message: `Connected as ${data.user} in ${data.team}` };
      }

      return { ok: false, error: data.error || 'Failed to verify connection' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Set weather integration enabled/disabled
   * @param username - Current username
   * @param enabled - Enable or disable weather
   * @returns Success/error response
   */
  static async setWeatherEnabled(
    username: string | null | undefined,
    enabled: boolean
  ): Promise<IntegrationsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const settingsPath = await getSettingsPath(username);
      let settings: any = {};

      try {
        settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      } catch {
        // No existing settings
      }

      settings.weatherEnabled = enabled;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get weather integration enabled status
   * @param username - Current username
   * @returns Enabled status (defaults to true)
   */
  static async getWeatherEnabled(username: string | null | undefined): Promise<IntegrationsResponse> {
    try {
      if (!username) {
        return { ok: true, enabled: true }; // Default to enabled when not logged in
      }

      const settingsPath = await getSettingsPath(username);
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      return { ok: true, enabled: settings.weatherEnabled !== false };
    } catch {
      return { ok: true, enabled: true }; // Default to enabled
    }
  }

  /**
   * Set browser automation enabled/disabled
   * @param username - Current username
   * @param enabled - Enable or disable browser automation
   * @returns Success/error response
   */
  static async setBrowserEnabled(
    username: string | null | undefined,
    enabled: boolean
  ): Promise<IntegrationsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const settingsPath = await getSettingsPath(username);
      let settings: any = {};

      try {
        settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      } catch {
        // No existing settings
      }

      settings.browserEnabled = enabled;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      console.log(`[Settings] Browser automation ${enabled ? 'enabled' : 'disabled'}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get browser automation enabled status
   * @param username - Current username
   * @returns Enabled status (defaults to false)
   */
  static async getBrowserEnabled(username: string | null | undefined): Promise<IntegrationsResponse> {
    try {
      if (!username) {
        return { ok: true, enabled: false }; // Default to disabled when not logged in
      }

      const settingsPath = await getSettingsPath(username);
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      return { ok: true, enabled: settings.browserEnabled === true };
    } catch {
      return { ok: true, enabled: false }; // Default to disabled
    }
  }
}
