/**
 * Telegram Service
 * Handles Telegram bot authentication and connection management
 */

import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

/**
 * Service response interface
 */
export interface TelegramResponse {
  ok: boolean;
  error?: string;
  bot?: {
    username: string;
    name: string;
  };
  authorized?: boolean;
  message?: string;
}

/**
 * TelegramService - Manages Telegram bot integration
 */
export class TelegramService {
  /**
   * Set Telegram bot token and verify it works
   * @param username - Current username
   * @param token - Telegram bot token
   * @returns Success/error response with bot info
   */
  static async setToken(
    username: string | null | undefined,
    token: string
  ): Promise<TelegramResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      // Save token to settings
      const settingsPath = await getSettingsPath(username);
      let settings: any = {};
      try {
        const settingsData = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsData);
      } catch {
        // No existing settings
      }

      settings.telegramBotToken = token;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      // Verify the token works
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data: any = await response.json();

      if (data.ok) {
        return {
          ok: true,
          bot: {
            username: data.result.username,
            name: data.result.first_name
          }
        };
      }

      return { ok: false, error: 'Invalid bot token' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Telegram] Error setting token:', error);
      return { ok: false, error };
    }
  }

  /**
   * Check if Telegram is authenticated
   * @param username - Current username
   * @returns Authorization status
   */
  static async checkAuth(
    username: string | null | undefined
  ): Promise<TelegramResponse> {
    try {
      if (!username) {
        return { ok: true, authorized: false };
      }

      const token = await this.getToken(username);
      return { ok: true, authorized: !!token };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Telegram] Error checking auth:', error);
      return { ok: false, error };
    }
  }

  /**
   * Disconnect Telegram by removing the token
   * @param username - Current username
   * @returns Success/error response
   */
  static async disconnect(
    username: string | null | undefined
  ): Promise<TelegramResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const settingsPath = await getSettingsPath(username);
      let settings: any = {};
      try {
        const settingsData = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsData);
      } catch {
        // No settings
      }

      delete settings.telegramBotToken;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Telegram] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  /**
   * Test Telegram connection
   * @param username - Current username
   * @returns Success/error response with connection message
   */
  static async test(
    username: string | null | undefined
  ): Promise<TelegramResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const token = await this.getToken(username);
      if (!token) {
        return { ok: false, error: 'Telegram not connected' };
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data: any = await response.json();

      if (data.ok) {
        return {
          ok: true,
          message: `Connected as @${data.result.username}`
        };
      }

      return { ok: false, error: 'Token verification failed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Telegram] Error testing connection:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get Telegram bot token from settings (private helper)
   * @param username - Current username
   * @returns Token or null
   */
  private static async getToken(username: string): Promise<string | null> {
    try {
      const settingsPath = await getSettingsPath(username);
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      return settings.telegramBotToken || null;
    } catch {
      return null;
    }
  }
}
