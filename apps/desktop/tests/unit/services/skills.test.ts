/**
 * Unit tests for SkillsService
 * Tests skill CRUD operations and template generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { SkillsService } = require('../../../dist/services/skills');

describe('SkillsService', () => {
  let testWovlyDir: string;
  let originalEnv: string | undefined;
  const testUsername = 'skills-test-user';

  beforeEach(async () => {
    // Create unique temp directory for this test run
    testWovlyDir = path.join(
      os.tmpdir(),
      `wovly-skills-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
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

  describe('listSkills', () => {
    it('should return empty array when not logged in', async () => {
      const result = await SkillsService.listSkills(null);

      expect(result.ok).toBe(true);
      expect(result.skills).toEqual([]);
    });

    it('should return empty array when no skills exist', async () => {
      const result = await SkillsService.listSkills(testUsername);

      expect(result.ok).toBe(true);
      expect(result.skills).toEqual([]);
    });

    it('should list all skills for user', async () => {
      // Create two skills
      const skillContent1 = `# Email Responder

## Description
Responds to emails professionally

## Keywords
email, respond, reply

## Procedure
1. Read the email
2. Draft a response
3. Send the reply
`;

      const skillContent2 = `# Meeting Scheduler

## Description
Schedule meetings with contacts

## Keywords
meeting, schedule, calendar

## Procedure
1. Find available time slots
2. Send meeting invite
`;

      await SkillsService.saveSkill(testUsername, 'email-responder', skillContent1);
      await SkillsService.saveSkill(testUsername, 'meeting-scheduler', skillContent2);

      const result = await SkillsService.listSkills(testUsername);

      expect(result.ok).toBe(true);
      expect(result.skills).toHaveLength(2);
      expect(result.skills![0].name).toBeDefined();
      expect(result.skills![1].name).toBeDefined();
    });
  });

  describe('getSkill', () => {
    it('should return error when not logged in', async () => {
      const result = await SkillsService.getSkill(null, 'test-skill');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for non-existent skill', async () => {
      const result = await SkillsService.getSkill(testUsername, 'nonexistent');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get skill with content', async () => {
      const skillContent = `# Test Skill

## Description
A test skill

## Keywords
test, demo

## Procedure
1. Step one
2. Step two
`;

      await SkillsService.saveSkill(testUsername, 'test-skill', skillContent);

      const result = await SkillsService.getSkill(testUsername, 'test-skill');

      expect(result.ok).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.id).toBe('test-skill');
      expect(result.skill!.name).toBe('Test Skill');
      expect(result.content).toBe(skillContent);
    });

    it('should parse skill metadata correctly', async () => {
      const skillContent = `# Data Analyzer

## Description
Analyze data and generate insights

## Keywords
data, analysis, insights, statistics

## Procedure
1. Load data
2. Process and clean
3. Analyze patterns
4. Generate report
`;

      await SkillsService.saveSkill(testUsername, 'data-analyzer', skillContent);

      const result = await SkillsService.getSkill(testUsername, 'data-analyzer');

      expect(result.ok).toBe(true);
      expect(result.skill!.description).toBe('Analyze data and generate insights');
      expect(result.skill!.keywords).toContain('data');
      expect(result.skill!.keywords).toContain('analysis');
    });
  });

  describe('saveSkill', () => {
    it('should return error when not logged in', async () => {
      const result = await SkillsService.saveSkill(null, 'test', 'content');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should create new skill', async () => {
      const skillContent = `# New Skill

## Description
Brand new skill

## Keywords
new, test

## Procedure
1. Do something
`;

      const result = await SkillsService.saveSkill(testUsername, 'new-skill', skillContent);

      expect(result.ok).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.id).toBe('new-skill');
      expect(result.skill!.name).toBe('New Skill');
    });

    it('should update existing skill', async () => {
      const originalContent = `# Original

## Description
Original description

## Keywords
original

## Procedure
1. Original step
`;

      const updatedContent = `# Updated

## Description
Updated description

## Keywords
updated, modified

## Procedure
1. New step
2. Another step
`;

      // Create original
      await SkillsService.saveSkill(testUsername, 'update-test', originalContent);

      // Update
      const result = await SkillsService.saveSkill(testUsername, 'update-test', updatedContent);

      expect(result.ok).toBe(true);
      expect(result.skill!.description).toBe('Updated description');

      // Verify update persisted
      const getResult = await SkillsService.getSkill(testUsername, 'update-test');
      expect(getResult.skill!.description).toBe('Updated description');
    });

    it('should create skill directory if it does not exist', async () => {
      const skillContent = `# First Skill

## Description
First skill for new user

## Keywords
first

## Procedure
1. Initialize
`;

      const result = await SkillsService.saveSkill(testUsername, 'first-skill', skillContent);

      expect(result.ok).toBe(true);
      expect(result.skill).toBeDefined();
    });
  });

  describe('deleteSkill', () => {
    it('should return error when not logged in', async () => {
      const result = await SkillsService.deleteSkill(null, 'test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should delete existing skill', async () => {
      const skillContent = `# To Delete

## Description
This will be deleted

## Keywords
delete

## Procedure
1. Delete this
`;

      // Create skill
      await SkillsService.saveSkill(testUsername, 'to-delete', skillContent);

      // Verify it exists
      const getResult = await SkillsService.getSkill(testUsername, 'to-delete');
      expect(getResult.ok).toBe(true);

      // Delete it
      const deleteResult = await SkillsService.deleteSkill(testUsername, 'to-delete');
      expect(deleteResult.ok).toBe(true);

      // Verify it's gone
      const getAfterDelete = await SkillsService.getSkill(testUsername, 'to-delete');
      expect(getAfterDelete.ok).toBe(false);
    });

    it('should handle deleting non-existent skill', async () => {
      const result = await SkillsService.deleteSkill(testUsername, 'nonexistent');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should remove skill from list after deletion', async () => {
      // Create two skills
      await SkillsService.saveSkill(testUsername, 'skill1', '# Skill 1\n\n## Description\nFirst');
      await SkillsService.saveSkill(testUsername, 'skill2', '# Skill 2\n\n## Description\nSecond');

      // Verify both exist
      let listResult = await SkillsService.listSkills(testUsername);
      expect(listResult.skills).toHaveLength(2);

      // Delete one
      await SkillsService.deleteSkill(testUsername, 'skill1');

      // Verify only one remains
      listResult = await SkillsService.listSkills(testUsername);
      expect(listResult.skills).toHaveLength(1);
      expect(listResult.skills![0].id).toBe('skill2');
    });
  });

  describe('getTemplate', () => {
    it('should return skill template', () => {
      const result = SkillsService.getTemplate();

      expect(result.ok).toBe(true);
      expect(result.template).toBeDefined();
      expect(result.template).toContain('# New Skill');
      expect(result.template).toContain('## Description');
      expect(result.template).toContain('## Keywords');
      expect(result.template).toContain('## Procedure');
      expect(result.template).toContain('## Constraints');
    });

    it('should return consistent template', () => {
      const result1 = SkillsService.getTemplate();
      const result2 = SkillsService.getTemplate();

      expect(result1.template).toBe(result2.template);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete skill lifecycle', async () => {
      // 1. Start with no skills
      let listResult = await SkillsService.listSkills(testUsername);
      expect(listResult.skills).toHaveLength(0);

      // 2. Get template
      const templateResult = SkillsService.getTemplate();
      expect(templateResult.template).toBeDefined();

      // 3. Create skill using template as base
      const customSkill = templateResult.template!.replace('New Skill', 'Custom Skill');
      await SkillsService.saveSkill(testUsername, 'custom-skill', customSkill);

      // 4. Verify it appears in list
      listResult = await SkillsService.listSkills(testUsername);
      expect(listResult.skills).toHaveLength(1);

      // 5. Get and modify the skill
      const getResult = await SkillsService.getSkill(testUsername, 'custom-skill');
      const modifiedContent = getResult.content!.replace('Custom Skill', 'Modified Skill');
      await SkillsService.saveSkill(testUsername, 'custom-skill', modifiedContent);

      // 6. Verify modification
      const getModified = await SkillsService.getSkill(testUsername, 'custom-skill');
      expect(getModified.content).toContain('Modified Skill');

      // 7. Delete the skill
      await SkillsService.deleteSkill(testUsername, 'custom-skill');

      // 8. Verify it's gone
      listResult = await SkillsService.listSkills(testUsername);
      expect(listResult.skills).toHaveLength(0);
    });

    it('should handle multiple users independently', async () => {
      const user1 = 'user1';
      const user2 = 'user2';

      // User 1 creates a skill
      await SkillsService.saveSkill(user1, 'user1-skill', '# User 1\n\n## Description\nUser 1 skill');

      // User 2 creates a skill
      await SkillsService.saveSkill(user2, 'user2-skill', '# User 2\n\n## Description\nUser 2 skill');

      // Each user should only see their own skill
      const user1Skills = await SkillsService.listSkills(user1);
      const user2Skills = await SkillsService.listSkills(user2);

      expect(user1Skills.skills).toHaveLength(1);
      expect(user1Skills.skills![0].id).toBe('user1-skill');

      expect(user2Skills.skills).toHaveLength(1);
      expect(user2Skills.skills![0].id).toBe('user2-skill');
    });
  });
});
