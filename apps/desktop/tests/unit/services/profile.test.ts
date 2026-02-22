/**
 * Integration tests for ProfileService
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { ProfileService } = require('../../../dist/services/profile');

describe('ProfileService (Integration)', () => {
  const testUsername = `test-profile-user-${Date.now()}`;
  let testWovlyDir: string;

  beforeAll(async () => {
    // Create a temporary .wovly-assistant directory structure with unique name
    testWovlyDir = path.join(os.tmpdir(), `.wovly-profile-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    const userDir = path.join(testWovlyDir, 'users', testUsername);
    await fs.mkdir(userDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getProfile', () => {
    it('should return error for null username', async () => {
      const result = await ProfileService.getProfile(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return profile for valid username', async () => {
      const result = await ProfileService.getProfile(testUsername);

      expect(result.ok).toBe(true);
      expect(result.profile).toBeDefined();
      expect(result.profile?.firstName).toBe('User'); // Default value
    });
  });

  describe('updateProfile', () => {
    it('should return error for null username', async () => {
      const result = await ProfileService.updateProfile(null, { firstName: 'Test' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should update profile fields', async () => {
      const updates = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        city: 'San Francisco'
      };

      const result = await ProfileService.updateProfile(testUsername, updates);

      expect(result.ok).toBe(true);
      expect(result.profile?.firstName).toBe('John');
      expect(result.profile?.lastName).toBe('Doe');
      expect(result.profile?.email).toBe('john@example.com');
      expect(result.profile?.city).toBe('San Francisco');
    });

    it('should merge updates with existing profile', async () => {
      // First update
      await ProfileService.updateProfile(testUsername, { firstName: 'Jane' });

      // Second update should preserve firstName
      const result = await ProfileService.updateProfile(testUsername, {
        occupation: 'Engineer'
      });

      expect(result.ok).toBe(true);
      expect(result.profile?.firstName).toBe('Jane');
      expect(result.profile?.occupation).toBe('Engineer');
    });

    it('should update onboarding stage', async () => {
      const result = await ProfileService.updateProfile(testUsername, {
        onboardingStage: 'completed'
      });

      expect(result.ok).toBe(true);
      expect(result.profile?.onboardingStage).toBe('completed');
    });
  });

  describe('needsOnboarding', () => {
    it('should return false for null username', async () => {
      const result = await ProfileService.needsOnboarding(null);

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(false);
    });

    it('should return true when onboarding not completed', async () => {
      // Set stage to something other than completed
      await ProfileService.updateProfile(testUsername, {
        onboardingStage: 'profile'
      });

      const result = await ProfileService.needsOnboarding(testUsername);

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(true);
      expect(result.profile?.onboardingStage).toBe('profile');
    });

    it('should return false when onboarding completed', async () => {
      // Complete onboarding
      await ProfileService.updateProfile(testUsername, {
        onboardingStage: 'completed'
      });

      const result = await ProfileService.needsOnboarding(testUsername);

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(false);
      expect(result.profile?.onboardingStage).toBe('completed');
    });
  });

  describe('addFacts', () => {
    it('should return error for null username', async () => {
      const result = await ProfileService.addFacts(null, [
        { summary: 'Test fact' }
      ]);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should add facts to profile', async () => {
      const facts = [
        { summary: 'I love pizza', confidence: 0.9 },
        { summary: 'I have a dog named Max', confidence: 0.95 }
      ];

      const result = await ProfileService.addFacts(testUsername, facts);

      expect(result.ok).toBe(true);

      // Verify facts were added
      const profile = await ProfileService.getProfile(testUsername);
      expect(profile.profile?.notes).toContain('I love pizza');
      expect(profile.profile?.notes).toContain('I have a dog named Max');
    });

    it('should handle conflict resolutions - keep new', async () => {
      // Add initial fact
      await ProfileService.addFacts(testUsername, [
        { summary: 'I live in New York' }
      ]);

      // Add conflicting fact with resolution to keep new
      const facts = [{ summary: 'I live in San Francisco' }];
      const resolutions = [
        {
          existingNote: 'I live in New York',
          newFact: 'I live in San Francisco',
          keepNew: true
        }
      ];

      const result = await ProfileService.addFacts(testUsername, facts, resolutions);

      expect(result.ok).toBe(true);

      // Verify old was removed and new was added
      const profile = await ProfileService.getProfile(testUsername);
      expect(profile.profile?.notes).not.toContain('I live in New York');
      expect(profile.profile?.notes).toContain('I live in San Francisco');
    });

    it('should handle conflict resolutions - keep existing', async () => {
      // Add initial fact
      await ProfileService.addFacts(testUsername, [
        { summary: 'I prefer tea' }
      ]);

      // Try to add conflicting fact with resolution to keep existing
      const facts = [{ summary: 'I prefer coffee' }];
      const resolutions = [
        {
          existingNote: 'I prefer tea',
          newFact: 'I prefer coffee',
          keepNew: false
        }
      ];

      const result = await ProfileService.addFacts(testUsername, facts, resolutions);

      expect(result.ok).toBe(true);

      // Verify existing was kept and new was not added
      const profile = await ProfileService.getProfile(testUsername);
      expect(profile.profile?.notes).toContain('I prefer tea');
      expect(profile.profile?.notes).not.toContain('I prefer coffee');
    });

    it('should handle multiple facts and resolutions', async () => {
      const facts = [
        { summary: 'I am 30 years old' },
        { summary: 'I work at Acme Corp' },
        { summary: 'I enjoy hiking' }
      ];

      const result = await ProfileService.addFacts(testUsername, facts);

      expect(result.ok).toBe(true);

      const profile = await ProfileService.getProfile(testUsername);
      expect(profile.profile?.notes).toContain('I am 30 years old');
      expect(profile.profile?.notes).toContain('I work at Acme Corp');
      expect(profile.profile?.notes).toContain('I enjoy hiking');
    });
  });

  describe('getMarkdown', () => {
    it('should return error for null username', async () => {
      const result = await ProfileService.getMarkdown(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return raw markdown', async () => {
      const result = await ProfileService.getMarkdown(testUsername);

      expect(result.ok).toBe(true);
      expect(result.markdown).toBeDefined();
      expect(result.markdown).toContain('# User Profile');
      expect(result.markdown).toContain('## Basic Info');
    });

    it('should include all profile data in markdown', async () => {
      // Update profile
      await ProfileService.updateProfile(testUsername, {
        firstName: 'Alice',
        lastName: 'Smith',
        occupation: 'Designer'
      });

      const result = await ProfileService.getMarkdown(testUsername);

      expect(result.ok).toBe(true);
      expect(result.markdown).toContain('Alice');
      expect(result.markdown).toContain('Smith');
      expect(result.markdown).toContain('Designer');
    });
  });

  describe('saveMarkdown', () => {
    it('should return error for null username', async () => {
      const result = await ProfileService.saveMarkdown(null, '# Test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should save raw markdown', async () => {
      const customMarkdown = `# User Profile

## Basic Info
- **First Name**: Bob
- **Last Name**: Johnson
- **Email**: bob@example.com
- **Date of Birth**: 1990-01-01
- **City**: Seattle

## Life Context
- **Occupation**: Developer
- **Home Life**: Married with 2 kids

## Goals
- Learn TypeScript
- Build a SaaS product

## Personal Notes
- Loves coding
- Coffee enthusiast

## System
- **User ID**: test-123
- **Created**: 2026-02-17T00:00:00.000Z
- **Onboarding Stage**: completed
- **Onboarding Skipped At**:
`;

      const result = await ProfileService.saveMarkdown(testUsername, customMarkdown);

      expect(result.ok).toBe(true);

      // Verify it was saved by reading it back
      const getResult = await ProfileService.getProfile(testUsername);
      expect(getResult.ok).toBe(true);
      expect(getResult.profile?.firstName).toBe('Bob');
      expect(getResult.profile?.lastName).toBe('Johnson');
      expect(getResult.profile?.occupation).toBe('Developer');
      expect(getResult.profile?.goals).toContain('Learn TypeScript');
      expect(getResult.profile?.notes).toContain('Loves coding');
    });
  });

  describe('updateField', () => {
    it('should update a single field', async () => {
      const result = await ProfileService.updateField(testUsername, 'city', 'Portland');

      expect(result.ok).toBe(true);
      expect(result.profile?.city).toBe('Portland');
    });

    it('should preserve other fields', async () => {
      // Set initial values
      await ProfileService.updateProfile(testUsername, {
        firstName: 'Charlie',
        lastName: 'Brown'
      });

      // Update just one field
      const result = await ProfileService.updateField(testUsername, 'email', 'charlie@example.com');

      expect(result.ok).toBe(true);
      expect(result.profile?.firstName).toBe('Charlie');
      expect(result.profile?.lastName).toBe('Brown');
      expect(result.profile?.email).toBe('charlie@example.com');
    });
  });
});
