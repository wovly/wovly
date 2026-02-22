/**
 * Unit tests for IntegrationsService
 * Tests integration testing and enable/disable flags
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { IntegrationsService } = require('../../../dist/services/integrations');

describe('IntegrationsService', () => {
  let testWovlyDir: string;
  let originalEnv: string | undefined;
  const testUsername = 'integrations-test-user';

  beforeEach(async () => {
    // Create unique temp directory for this test run
    testWovlyDir = path.join(
      os.tmpdir(),
      `wovly-integrations-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    await fs.mkdir(testWovlyDir, { recursive: true });

    // Override WOVLY_DIR environment variable
    originalEnv = process.env.WOVLY_DIR;
    process.env.WOVLY_DIR = testWovlyDir;
  });

  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.WOVLY_DIR = originalEnv;
    } else {
      delete process.env.WOVLY_DIR;
    }

    // Clean up test directory
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('testGoogle', () => {
    it('should return error when not authorized', async () => {
      const mockGetToken = async () => null;

      const result = await IntegrationsService.testGoogle(mockGetToken, testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not authorized');
    });

    it('should return success when Google and Calendar are accessible', async () => {
      const mockGetToken = async () => 'fake-token';

      // Mock fetch globally
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        } as any)
        .mockResolvedValueOnce({
          ok: true
        } as any);

      const result = await IntegrationsService.testGoogle(mockGetToken, testUsername);

      expect(result.ok).toBe(true);
      expect(result.message).toContain('test@example.com');
      expect(result.message).toContain('Calendar: ✓');
    });

    it('should return error when Calendar access is denied', async () => {
      const mockGetToken = async () => 'fake-token';

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => 'Forbidden'
        } as any);

      const result = await IntegrationsService.testGoogle(mockGetToken, testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Calendar access denied');
    });
  });

  describe('testIMessage', () => {
    it('should return error on non-macOS platforms', async () => {
      // Save original platform
      const originalPlatform = process.platform;

      // Mock platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      const result = await IntegrationsService.testIMessage();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('only available on macOS');

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true
      });
    });

    // Note: Testing actual iMessage database access would require macOS and Full Disk Access
    // This test would only pass on macOS with proper permissions
  });

  describe('testWeather', () => {
    it('should return success when weather API is accessible', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 20 // 20°C = 68°F
          }
        })
      } as any);

      const result = await IntegrationsService.testWeather();

      expect(result.ok).toBe(true);
      expect(result.message).toContain('Weather API connected');
      expect(result.message).toContain('°F');
    });

    it('should return error when weather API fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false
      } as any);

      const result = await IntegrationsService.testWeather();

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('testBrowser', () => {
    it('should return error when not logged in', async () => {
      const mockGetController = async () => ({});

      const result = await IntegrationsService.testBrowser(mockGetController, null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return success when browser automation works', async () => {
      const mockGetController = async () => ({
        navigate: async () => ({ title: 'Example Domain' }),
        contexts: new Map()
      });

      const result = await IntegrationsService.testBrowser(mockGetController, testUsername);

      expect(result.ok).toBe(true);
      expect(result.message).toContain('Browser automation');
    });
  });

  describe('testSlack', () => {
    it('should return error when not authorized', async () => {
      const mockGetToken = async () => null;

      const result = await IntegrationsService.testSlack(mockGetToken, testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not authorized');
    });

    it('should return success when Slack is connected', async () => {
      const mockGetToken = async () => 'fake-token';

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          user: 'testuser',
          team: 'Test Team'
        })
      } as any);

      const result = await IntegrationsService.testSlack(mockGetToken, testUsername);

      expect(result.ok).toBe(true);
      expect(result.message).toContain('testuser');
      expect(result.message).toContain('Test Team');
    });

    it('should return error when Slack auth fails', async () => {
      const mockGetToken = async () => 'fake-token';

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          error: 'invalid_auth'
        })
      } as any);

      const result = await IntegrationsService.testSlack(mockGetToken, testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('invalid_auth');
    });
  });

  describe('setWeatherEnabled / getWeatherEnabled', () => {
    it('should return error when not logged in (setWeatherEnabled)', async () => {
      const result = await IntegrationsService.setWeatherEnabled(null, true);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should enable weather integration', async () => {
      const setResult = await IntegrationsService.setWeatherEnabled(testUsername, true);
      expect(setResult.ok).toBe(true);

      const getResult = await IntegrationsService.getWeatherEnabled(testUsername);
      expect(getResult.ok).toBe(true);
      expect(getResult.enabled).toBe(true);
    });

    it('should disable weather integration', async () => {
      const setResult = await IntegrationsService.setWeatherEnabled(testUsername, false);
      expect(setResult.ok).toBe(true);

      const getResult = await IntegrationsService.getWeatherEnabled(testUsername);
      expect(getResult.ok).toBe(true);
      expect(getResult.enabled).toBe(false);
    });

    it('should default to enabled when no settings file exists', async () => {
      const result = await IntegrationsService.getWeatherEnabled(testUsername);

      expect(result.ok).toBe(true);
      expect(result.enabled).toBe(true);
    });

    it('should default to enabled when not logged in', async () => {
      const result = await IntegrationsService.getWeatherEnabled(null);

      expect(result.ok).toBe(true);
      expect(result.enabled).toBe(true);
    });
  });

  describe('setBrowserEnabled / getBrowserEnabled', () => {
    it('should return error when not logged in (setBrowserEnabled)', async () => {
      const result = await IntegrationsService.setBrowserEnabled(null, true);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should enable browser automation', async () => {
      const setResult = await IntegrationsService.setBrowserEnabled(testUsername, true);
      expect(setResult.ok).toBe(true);

      const getResult = await IntegrationsService.getBrowserEnabled(testUsername);
      expect(getResult.ok).toBe(true);
      expect(getResult.enabled).toBe(true);
    });

    it('should disable browser automation', async () => {
      const setResult = await IntegrationsService.setBrowserEnabled(testUsername, false);
      expect(setResult.ok).toBe(true);

      const getResult = await IntegrationsService.getBrowserEnabled(testUsername);
      expect(getResult.ok).toBe(true);
      expect(getResult.enabled).toBe(false);
    });

    it('should default to disabled when no settings file exists', async () => {
      const result = await IntegrationsService.getBrowserEnabled(testUsername);

      expect(result.ok).toBe(true);
      expect(result.enabled).toBe(false);
    });

    it('should default to disabled when not logged in', async () => {
      const result = await IntegrationsService.getBrowserEnabled(null);

      expect(result.ok).toBe(true);
      expect(result.enabled).toBe(false);
    });
  });

  describe('Integration scenarios', () => {
    it('should persist settings across get/set operations', async () => {
      // Enable weather
      await IntegrationsService.setWeatherEnabled(testUsername, true);

      // Enable browser
      await IntegrationsService.setBrowserEnabled(testUsername, true);

      // Verify both are enabled
      const weatherResult = await IntegrationsService.getWeatherEnabled(testUsername);
      const browserResult = await IntegrationsService.getBrowserEnabled(testUsername);

      expect(weatherResult.enabled).toBe(true);
      expect(browserResult.enabled).toBe(true);

      // Disable weather (browser should remain enabled)
      await IntegrationsService.setWeatherEnabled(testUsername, false);

      const weatherResult2 = await IntegrationsService.getWeatherEnabled(testUsername);
      const browserResult2 = await IntegrationsService.getBrowserEnabled(testUsername);

      expect(weatherResult2.enabled).toBe(false);
      expect(browserResult2.enabled).toBe(true); // Still enabled
    });
  });
});
