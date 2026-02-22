/**
 * Tests for DiscordService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Import the compiled service
const { DiscordService } = require('../../../dist/services/discord');

describe('DiscordService', () => {
  let testWovlyDir: string;
  let testUsername: string;
  let mockShell: any;
  let mockGetAccessToken: any;

  beforeEach(async () => {
    testWovlyDir = path.join(os.tmpdir(), `wovly-test-${Date.now()}`);
    testUsername = 'testuser';
    process.env.WOVLY_DIR = testWovlyDir;

    // Create user directory structure
    const userDir = path.join(testWovlyDir, 'users', testUsername);
    await fs.mkdir(userDir, { recursive: true });

    // Create test settings file
    const settingsPath = path.join(userDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({}, null, 2), 'utf8');

    // Mock shell
    mockShell = {
      openExternal: vi.fn().mockResolvedValue(undefined)
    };

    // Mock getAccessToken
    mockGetAccessToken = vi.fn().mockResolvedValue(null);

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

  describe('checkAuth', () => {
    it('should return authorized true when token exists', async () => {
      mockGetAccessToken = vi.fn().mockResolvedValue('test-token');

      const result = await DiscordService.checkAuth(testUsername, mockGetAccessToken);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(true);
    });

    it('should return authorized false when token does not exist', async () => {
      const result = await DiscordService.checkAuth(testUsername, mockGetAccessToken);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(false);
    });

    it('should return authorized false when not logged in', async () => {
      const result = await DiscordService.checkAuth(null, mockGetAccessToken);

      expect(result.ok).toBe(true);
      expect(result.authorized).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should remove Discord tokens from settings', async () => {
      // Save tokens to settings
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.writeFile(
        settingsPath,
        JSON.stringify({
          discordTokens: { access_token: 'test' },
          otherSetting: 'value'
        }, null, 2),
        'utf8'
      );

      const result = await DiscordService.disconnect(testUsername);

      expect(result.ok).toBe(true);

      // Verify tokens removed but other settings remain
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.discordTokens).toBeUndefined();
      expect(settings.otherSetting).toBe('value');
    });

    it('should return error when not logged in', async () => {
      const result = await DiscordService.disconnect(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should succeed even if no tokens exist', async () => {
      const result = await DiscordService.disconnect(testUsername);

      expect(result.ok).toBe(true);
    });
  });

  describe('test', () => {
    it('should verify connection with valid token', async () => {
      mockGetAccessToken = vi.fn().mockResolvedValue('test-token');

      // Mock successful API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          username: 'test_user'
        })
      });

      const result = await DiscordService.test(testUsername, mockGetAccessToken);

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Connected as test_user');
    });

    it('should return error when not connected', async () => {
      const result = await DiscordService.test(testUsername, mockGetAccessToken);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Discord not connected');
    });

    it('should return error when not logged in', async () => {
      const result = await DiscordService.test(null, mockGetAccessToken);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should handle API errors', async () => {
      mockGetAccessToken = vi.fn().mockResolvedValue('test-token');

      // Mock failed API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'Unauthorized'
        })
      });

      const result = await DiscordService.test(testUsername, mockGetAccessToken);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection test failed');
    });
  });
});
