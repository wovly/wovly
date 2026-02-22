/**
 * Tests for InsightsService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Import the compiled service
const { InsightsService } = require('../../../dist/services/insights');

describe('InsightsService', () => {
  let testWovlyDir: string;
  let testUsername: string;

  beforeEach(async () => {
    testWovlyDir = path.join(os.tmpdir(), `wovly-test-${Date.now()}`);
    testUsername = 'testuser';
    process.env.WOVLY_DIR = testWovlyDir;

    // Create user directory structure
    const userDir = path.join(testWovlyDir, 'users', testUsername);
    const insightsDir = path.join(userDir, 'insights');
    await fs.mkdir(insightsDir, { recursive: true });

    // Create test settings file
    const settingsPath = path.join(userDir, 'settings.json');
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ insightsLimit: 5 }, null, 2),
      'utf8'
    );

    // Create test insights file
    const today = new Date().toISOString().split('T')[0];
    const insightsPath = path.join(insightsDir, `${today}.json`);
    const testInsights = {
      date: today,
      timestamp: new Date().toISOString(),
      insights: [
        { id: 1, text: 'Insight 1', priority: 'high' },
        { id: 2, text: 'Insight 2', priority: 'medium' },
        { id: 3, text: 'Insight 3', priority: 'low' },
        { id: 4, text: 'Insight 4', priority: 'medium' },
        { id: 5, text: 'Insight 5', priority: 'high' },
        { id: 6, text: 'Insight 6', priority: 'low' },
        { id: 7, text: 'Insight 7', priority: 'medium' }
      ]
    };
    await fs.writeFile(insightsPath, JSON.stringify(testInsights, null, 2), 'utf8');
  });

  afterEach(async () => {
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
    delete process.env.WOVLY_DIR;
  });

  describe('setLimit', () => {
    it('should save insights limit preference', async () => {
      const result = await InsightsService.setLimit(testUsername, 10);

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify settings file updated
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.insightsLimit).toBe(10);
    });

    it('should use default limit of 5', async () => {
      const result = await InsightsService.setLimit(testUsername);

      expect(result.ok).toBe(true);

      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.insightsLimit).toBe(5);
    });

    it('should return error when not logged in', async () => {
      const result = await InsightsService.setLimit(null, 10);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should handle file errors gracefully', async () => {
      // Use invalid username to trigger error
      const result = await InsightsService.setLimit('nonexistent', 10);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getToday', () => {
    it('should load today\'s insights with limit', async () => {
      const result = await InsightsService.getToday(testUsername, 3);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(3);
      expect(result.insights![0].id).toBe(1);
      expect(result.insights![1].id).toBe(2);
      expect(result.insights![2].id).toBe(3);
    });

    it('should use default limit of 5', async () => {
      const result = await InsightsService.getToday(testUsername);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(5);
    });

    it('should return all insights if limit exceeds total', async () => {
      const result = await InsightsService.getToday(testUsername, 100);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(7); // Total insights in test file
    });

    it('should return error when not logged in', async () => {
      const result = await InsightsService.getToday(null, 5);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
      expect(result.insights).toEqual([]);
    });

    it('should return empty array if no insights exist', async () => {
      // Delete insights file
      const today = new Date().toISOString().split('T')[0];
      const insightsPath = path.join(testWovlyDir, 'users', testUsername, 'insights', `${today}.json`);
      await fs.rm(insightsPath, { force: true });

      const result = await InsightsService.getToday(testUsername, 5);

      expect(result.ok).toBe(true);
      expect(result.insights).toEqual([]);
    });
  });

  describe('refresh', () => {
    it('should trigger insights generation and return updated insights', async () => {
      const mockRunInsightsCheck = vi.fn().mockResolvedValue(undefined);

      const result = await InsightsService.refresh(testUsername, 3, mockRunInsightsCheck);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(3);
      expect(mockRunInsightsCheck).toHaveBeenCalledWith(3);
    });

    it('should save limit preference before triggering generation', async () => {
      const mockRunInsightsCheck = vi.fn().mockResolvedValue(undefined);

      await InsightsService.refresh(testUsername, 10, mockRunInsightsCheck);

      // Verify settings file updated
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      expect(settings.insightsLimit).toBe(10);
    });

    it('should continue even if saving limit preference fails', async () => {
      const mockRunInsightsCheck = vi.fn().mockResolvedValue(undefined);

      // Delete settings file to trigger error
      const settingsPath = path.join(testWovlyDir, 'users', testUsername, 'settings.json');
      await fs.rm(settingsPath, { force: true });

      const result = await InsightsService.refresh(testUsername, 5, mockRunInsightsCheck);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(5);
      expect(mockRunInsightsCheck).toHaveBeenCalled();
    });

    it('should return error when not logged in', async () => {
      const mockRunInsightsCheck = vi.fn();

      const result = await InsightsService.refresh(null, 5, mockRunInsightsCheck);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
      expect(result.insights).toEqual([]);
      expect(mockRunInsightsCheck).not.toHaveBeenCalled();
    });

    it('should handle insights generation errors', async () => {
      const mockRunInsightsCheck = vi.fn().mockRejectedValue(new Error('Generation failed'));

      const result = await InsightsService.refresh(testUsername, 5, mockRunInsightsCheck);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Generation failed');
      expect(result.insights).toEqual([]);
    });

    it('should use default limit of 5', async () => {
      const mockRunInsightsCheck = vi.fn().mockResolvedValue(undefined);

      const result = await InsightsService.refresh(testUsername, undefined, mockRunInsightsCheck);

      expect(result.ok).toBe(true);
      expect(result.insights).toHaveLength(5);
      expect(mockRunInsightsCheck).toHaveBeenCalledWith(5);
    });
  });
});
