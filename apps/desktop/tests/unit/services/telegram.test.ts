/**
 * Tests for TelegramService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Import the compiled service
const { TelegramService } = require('../../../dist/services/telegram');

describe('TelegramService', () => {
  let testWovlyDir: string;
  let testUsername: string;

  beforeEach(async () => {
    testWovlyDir = path.join(os.tmpdir(), `wovly-test-${Date.now()}`);
    testUsername = 'testuser';
    process.env.WOVLY_DIR = testWovlyDir;

    // Create user directory structure
    const userDir = path.join(testWovlyDir, 'users', testUsername);
    await fs.mkdir(userDir, { recursive: true });

    // Create test settings file
    const settingsPath = path.join(userDir, 'settings.json');
    await fs.writeFile(
      settingsPath,
      JSON.stringify({}, null, 2),
      'utf8'
    );

    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
    delete process.env.WOVLY_DIR;
    vi.restoreAllMocks();
  });

  describe('setToken', () => {
    it('should save valid token and return bot info', async () => {
      // Mock successful API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            username: 'test_bot',
            first_name: 'Test Bot'
          }
        })
      });

      const result = await TelegramService.setToken(testUsername, 'test-token-123');

      expect(result.ok).toBe(true);
      expect(result.bot).toEqual({
        username: 'test_bot',
        name: 'Test Bot'
      });

      // Verify token was saved to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.telegramBotToken).toBe('test-token-123');
    });

    it('should return error for invalid token', async () => {
      // Mock failed API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Unauthorized'
        })
      });

      const result = await TelegramService.setToken(testUsername, 'invalid-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid bot token');
    });

    it('should return error when not logged in', async () => {
      const result = await TelegramService.setToken(null, 'test-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should handle API errors gracefully', async () => {
      // Mock network error
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await TelegramService.setToken(testUsername, 'test-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should save token even if no previous settings exist', async () => {
      // Delete settings file
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.rm(settingsPath, { force: true });

      // Mock successful API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            username: 'test_bot',
            first_name: 'Test Bot'
          }
        })
      });

      const result = await TelegramService.setToken(testUsername, 'test-token');

      expect(result.ok).toBe(true);

      // Verify token was saved
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.telegramBotToken).toBe('test-token');
    });
  });

  describe('checkAuth', () => {
    it('should return authorized true when token exists', async () => {
      // Save token to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ telegramBotToken: 'test-token' }, null, 2),
        'utf8'
      );

      const result = await TelegramService.checkAuth(testUsername);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(true);
    });

    it('should return authorized false when token does not exist', async () => {
      const result = await TelegramService.checkAuth(testUsername);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(false);
    });

    it('should return authorized false when not logged in', async () => {
      const result = await TelegramService.checkAuth(null);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(false);
    });

    it('should return authorized false when settings file does not exist', async () => {
      // Delete settings file
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.rm(settingsPath, { force: true });

      const result = await TelegramService.checkAuth(testUsername);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should remove token from settings', async () => {
      // Save token to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ telegramBotToken: 'test-token', otherSetting: 'value' }, null, 2),
        'utf8'
      );

      const result = await TelegramService.disconnect(testUsername);

      expect(result.ok).toBe(true);

      // Verify token was removed but other settings remain
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.telegramBotToken).toBeUndefined();
      expect(settings.otherSetting).toBe('value');
    });

    it('should return error when not logged in', async () => {
      const result = await TelegramService.disconnect(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should succeed even if no token exists', async () => {
      const result = await TelegramService.disconnect(testUsername);

      expect(result.ok).toBe(true);
    });

    it('should succeed even if settings file does not exist', async () => {
      // Delete settings file
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.rm(settingsPath, { force: true });

      const result = await TelegramService.disconnect(testUsername);

      expect(result.ok).toBe(true);
    });
  });

  describe('test', () => {
    it('should verify connection with valid token', async () => {
      // Save token to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ telegramBotToken: 'test-token' }, null, 2),
        'utf8'
      );

      // Mock successful API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            username: 'test_bot'
          }
        })
      });

      const result = await TelegramService.test(testUsername);

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Connected as @test_bot');
    });

    it('should return error when not connected', async () => {
      const result = await TelegramService.test(testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Telegram not connected');
    });

    it('should return error when not logged in', async () => {
      const result = await TelegramService.test(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error when token verification fails', async () => {
      // Save token to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ telegramBotToken: 'invalid-token' }, null, 2),
        'utf8'
      );

      // Mock failed API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Unauthorized'
        })
      });

      const result = await TelegramService.test(testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Token verification failed');
    });

    it('should handle API errors gracefully', async () => {
      // Save token to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ telegramBotToken: 'test-token' }, null, 2),
        'utf8'
      );

      // Mock network error
      (global.fetch as any).mockRejectedValue(new Error('Network timeout'));

      const result = await TelegramService.test(testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network timeout');
    });
  });
});
