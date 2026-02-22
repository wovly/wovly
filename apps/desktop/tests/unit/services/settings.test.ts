/**
 * Integration tests for SettingsService
 * These tests use real file I/O with temporary directories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { SettingsService } = require('../../../dist/services/settings');

describe('SettingsService (Integration)', () => {
  const testUsername = 'test-settings-user';
  let testWovlyDir: string;
  let settingsPath: string;

  beforeAll(async () => {
    // Create a temporary .wovly-assistant directory structure
    testWovlyDir = path.join(os.tmpdir(), `.wovly-test-${Date.now()}`);
    const userDir = path.join(testWovlyDir, 'users', testUsername);
    await fs.mkdir(userDir, { recursive: true });

    settingsPath = path.join(userDir, 'settings.json');

    // Override HOME for getUserDataDir to use our test directory
    process.env.WOVLY_TEST_DIR = testWovlyDir;
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    delete process.env.WOVLY_TEST_DIR;
  });

  describe('Basic Operations', () => {
    it('should return empty settings for null username', async () => {
      const result = await SettingsService.getSettings(null);

      expect(result.ok).toBe(true);
      expect(result.settings).toEqual({});
    });

    it('should validate activeProvider', async () => {
      const result = await SettingsService.updateSettings(testUsername, {
        activeProvider: 'invalid' as any
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid provider');
    });

    it('should validate theme', async () => {
      const result = await SettingsService.updateSettings(testUsername, {
        theme: 'invalid' as any
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid theme');
    });

    it('should validate apiKeys structure', async () => {
      const result = await SettingsService.updateSettings(testUsername, {
        apiKeys: 'not-an-object' as any
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('apiKeys must be an object');
    });

    it('should validate API key values are strings', async () => {
      const result = await SettingsService.updateSettings(testUsername, {
        apiKeys: { anthropic: 123 as any }
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('must be a string');
    });

    it('should accept valid settings with all providers', async () => {
      const validSettings = {
        apiKeys: {
          anthropic: 'sk-ant-test',
          openai: 'sk-test',
          google: 'gcp-test'
        },
        activeProvider: 'anthropic' as const,
        theme: 'dark' as const
      };

      const result = await SettingsService.updateSettings(testUsername, validSettings);

      expect(result.ok).toBe(true);
    });

    it('should merge settings correctly', async () => {
      // First update
      await SettingsService.updateSettings(testUsername, {
        theme: 'light' as const
      });

      // Second update should merge
      const result = await SettingsService.updateSettings(testUsername, {
        activeProvider: 'openai' as const
      });

      expect(result.ok).toBe(true);
    });

    it('should handle missing username for updateSettings', async () => {
      const result = await SettingsService.updateSettings(null, { theme: 'dark' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined in apiKeys gracefully', async () => {
      const result = await SettingsService.updateSettings(testUsername, {
        apiKeys: {
          anthropic: undefined,
          openai: 'sk-test'
        }
      });

      // undefined values are allowed (they just won't be set)
      expect(result.ok).toBe(true);
    });

    it('should accept all valid themes', async () => {
      const themes = ['light', 'dark', 'auto'] as const;

      for (const theme of themes) {
        const result = await SettingsService.updateSettings(testUsername, { theme });
        expect(result.ok).toBe(true);
      }
    });

    it('should accept all valid providers', async () => {
      const providers = ['anthropic', 'openai', 'google'] as const;

      for (const provider of providers) {
        const result = await SettingsService.updateSettings(testUsername, {
          activeProvider: provider
        });
        expect(result.ok).toBe(true);
      }
    });
  });
});
