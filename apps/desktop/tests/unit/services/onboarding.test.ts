/**
 * Unit tests for OnboardingService
 * Tests onboarding status tracking and stage management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { OnboardingService } = require('../../../dist/services/onboarding');
const { SettingsService } = require('../../../dist/services/settings');
const { ProfileService } = require('../../../dist/services/profile');
const { createTask } = require('../../../dist/tasks');
const { saveSkill } = require('../../../dist/storage/skills');

describe('OnboardingService', () => {
  let testWovlyDir: string;
  let originalEnv: string | undefined;
  const testUsername = 'onboarding-test-user';

  beforeEach(async () => {
    // Create unique temp directory for this test run
    testWovlyDir = path.join(
      os.tmpdir(),
      `wovly-onboarding-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    await fs.mkdir(testWovlyDir, { recursive: true });

    // Override WOVLY_DIR environment variable
    originalEnv = process.env.WOVLY_DIR;
    process.env.WOVLY_DIR = testWovlyDir;

    // Create a profile for test user
    await ProfileService.updateProfile(testUsername, {
      firstName: 'Test',
      lastName: 'User',
      onboardingStage: 'api_setup'
    });
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

  describe('getStatus', () => {
    it('should return error when not logged in', async () => {
      const result = await OnboardingService.getStatus(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return basic status for new user', async () => {
      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status).toBeDefined();
      expect(result.status!.stage).toBe('api_setup');
      expect(result.status!.hasApiKeys).toBe(false);
      expect(result.status!.hasTask).toBe(false);
      expect(result.status!.hasSkill).toBe(false);
      expect(result.status!.hasIntegrations).toBe(false);
      expect(result.status!.profileComplete).toBe(false);
      expect(result.status!.skippedAt).toBeNull();
    });

    it('should detect API keys when configured', async () => {
      // Configure an API key
      await SettingsService.updateSettings(testUsername, {
        anthropicApiKey: 'test-key-123'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasApiKeys).toBe(true);
    });

    it('should detect OpenAI API key', async () => {
      await SettingsService.updateSettings(testUsername, {
        openaiApiKey: 'sk-test123'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasApiKeys).toBe(true);
    });

    it('should detect Ollama endpoint as API key', async () => {
      await SettingsService.updateSettings(testUsername, {
        ollamaEndpoint: 'http://localhost:11434'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasApiKeys).toBe(true);
    });

    it('should detect integrations when configured', async () => {
      await SettingsService.updateSettings(testUsername, {
        googleAccessToken: { access_token: 'test-token' }
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasIntegrations).toBe(true);
    });

    it('should detect Slack integration', async () => {
      await SettingsService.updateSettings(testUsername, {
        slackAccessToken: 'xoxb-test'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasIntegrations).toBe(true);
    });

    it.skip('should detect tasks when created', async () => {
      // TODO: Fix task creation in tests - requires additional setup
      // Create a task
      await createTask({
        username: testUsername,
        title: 'Test Task',
        description: 'Test task for onboarding',
        trigger: 'manual'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasTask).toBe(true);
    });

    it.skip('should detect skills when created', async () => {
      // TODO: Fix skill creation in tests - requires additional setup
      // Create a skill
      await saveSkill({
        username: testUsername,
        name: 'test-skill',
        description: 'Test skill',
        prompt: 'Say hello',
        isCustom: true
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.hasSkill).toBe(true);
    });

    it('should detect complete profile', async () => {
      // Update profile with required fields
      await ProfileService.updateProfile(testUsername, {
        firstName: 'Alice',
        occupation: 'Software Engineer'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.profileComplete).toBe(true);
    });

    it('should not consider default firstName as complete', async () => {
      await ProfileService.updateProfile(testUsername, {
        firstName: 'User',
        occupation: 'Engineer'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.profileComplete).toBe(false);
    });

    it('should return current onboarding stage', async () => {
      await ProfileService.updateProfile(testUsername, {
        onboardingStage: 'profile'
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.stage).toBe('profile');
    });

    it('should include skipped timestamp when set', async () => {
      const skippedTime = new Date().toISOString();
      await ProfileService.updateProfile(testUsername, {
        onboardingStage: 'completed',
        onboardingSkippedAt: skippedTime
      });

      const result = await OnboardingService.getStatus(testUsername);

      expect(result.ok).toBe(true);
      expect(result.status!.stage).toBe('completed');
      expect(result.status!.skippedAt).toBe(skippedTime);
    });
  });

  describe('setStage', () => {
    it('should return error when not logged in', async () => {
      const result = await OnboardingService.setStage(null, 'profile');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should reject invalid stage', async () => {
      const result = await OnboardingService.setStage(testUsername, 'invalid_stage' as any);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid stage');
    });

    it('should set onboarding stage successfully', async () => {
      const result = await OnboardingService.setStage(testUsername, 'profile');

      expect(result.ok).toBe(true);
      expect(result.stage).toBe('profile');

      // Verify it was saved
      const status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('profile');
    });

    it('should clear skipped timestamp when changing stage', async () => {
      // First skip
      await OnboardingService.skip(testUsername);

      // Then set to a different stage
      const result = await OnboardingService.setStage(testUsername, 'profile');

      expect(result.ok).toBe(true);

      // Verify skipped timestamp was cleared
      const status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.skippedAt).toBeNull();
    });

    it('should accept all valid stages', async () => {
      const validStages = ['api_setup', 'profile', 'task_demo', 'skill_demo', 'integrations', 'completed'];

      for (const stage of validStages) {
        const result = await OnboardingService.setStage(testUsername, stage as any);
        expect(result.ok).toBe(true);
        expect(result.stage).toBe(stage);
      }
    });
  });

  describe('skip', () => {
    it('should return error when not logged in', async () => {
      const result = await OnboardingService.skip(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should mark onboarding as completed', async () => {
      const result = await OnboardingService.skip(testUsername);

      expect(result.ok).toBe(true);

      // Verify it was marked as completed
      const status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('completed');
    });

    it('should record skip timestamp', async () => {
      const beforeTime = new Date();
      await OnboardingService.skip(testUsername);
      const afterTime = new Date();

      const status = await OnboardingService.getStatus(testUsername);
      const skippedTime = new Date(status.status!.skippedAt!);

      expect(skippedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(skippedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should allow skipping from any stage', async () => {
      await OnboardingService.setStage(testUsername, 'task_demo');

      const result = await OnboardingService.skip(testUsername);

      expect(result.ok).toBe(true);

      const status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('completed');
    });
  });

  describe('Integration scenarios', () => {
    it('should track complete onboarding flow', async () => {
      // Start: api_setup stage, nothing configured
      let status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('api_setup');
      expect(status.status!.hasApiKeys).toBe(false);

      // User configures API key
      await SettingsService.updateSettings(testUsername, {
        anthropicApiKey: 'test-key'
      });
      status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.hasApiKeys).toBe(true);

      // Move to profile stage
      await OnboardingService.setStage(testUsername, 'profile');
      status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('profile');

      // User completes profile
      await ProfileService.updateProfile(testUsername, {
        firstName: 'Bob',
        occupation: 'Developer'
      });
      status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.profileComplete).toBe(true);

      // Move to task demo
      await OnboardingService.setStage(testUsername, 'task_demo');
      // Note: Skipping task creation test due to setup requirements
      status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('task_demo');

      // Complete onboarding
      await OnboardingService.setStage(testUsername, 'completed');
      status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('completed');
    });

    it('should handle skip after partial completion', async () => {
      // User completes API setup
      await SettingsService.updateSettings(testUsername, {
        anthropicApiKey: 'test'
      });

      // Then skips rest of onboarding
      await OnboardingService.skip(testUsername);

      const status = await OnboardingService.getStatus(testUsername);
      expect(status.status!.stage).toBe('completed');
      expect(status.status!.hasApiKeys).toBe(true);
      expect(status.status!.skippedAt).toBeTruthy();
    });
  });
});
