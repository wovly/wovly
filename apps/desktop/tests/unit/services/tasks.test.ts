/**
 * Unit tests for TasksService
 * Tests task CRUD operations and preference management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { TasksService } = require('../../../dist/services/tasks');

describe('TasksService', () => {
  let testWovlyDir: string;
  let originalEnv: string | undefined;
  const testUsername = 'tasks-test-user';

  beforeEach(async () => {
    // Create unique temp directory for this test run
    testWovlyDir = path.join(
      os.tmpdir(),
      `wovly-tasks-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
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

  describe('listTasks', () => {
    it('should return empty array when not logged in', async () => {
      const result = await TasksService.listTasks(null);

      expect(result.ok).toBe(true);
      expect(result.tasks).toEqual([]);
    });

    it('should return empty array when no tasks exist', async () => {
      const result = await TasksService.listTasks(testUsername);

      expect(result.ok).toBe(true);
      expect(result.tasks).toEqual([]);
    });

    it('should list all tasks for user', async () => {
      // Create two tasks
      await TasksService.createTask(testUsername, {
        title: 'Task 1',
        originalRequest: 'Do task 1',
        plan: ['Step 1', 'Step 2']
      });

      await TasksService.createTask(testUsername, {
        title: 'Task 2',
        originalRequest: 'Do task 2',
        plan: ['Step A', 'Step B']
      });

      const result = await TasksService.listTasks(testUsername);

      expect(result.ok).toBe(true);
      expect(result.tasks).toHaveLength(2);
    });
  });

  describe('getTask', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.getTask('test-task', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for non-existent task', async () => {
      const result = await TasksService.getTask('nonexistent', testUsername);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get task by ID', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Test Task',
        originalRequest: 'Test query',
        plan: ['Step 1', 'Step 2', 'Step 3']
      });

      const taskId = created.task!.id;
      const result = await TasksService.getTask(taskId, testUsername);

      expect(result.ok).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task!.id).toBe(taskId);
      expect(result.task!.title).toBe('Test Task');
      expect(result.task!.plan).toEqual(['Step 1', 'Step 2', 'Step 3']);
    });
  });

  describe('createTask', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.createTask(null, {
        title: 'Test',
        plan: ['Step 1']
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should create new task', async () => {
      const result = await TasksService.createTask(testUsername, {
        title: 'New Task',
        originalRequest: 'Create something',
        plan: ['Step 1', 'Step 2']
      });

      expect(result.ok).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task!.id).toBeDefined();
      expect(result.task!.title).toBe('New Task');
      expect(result.task!.status).toBe('active');
      expect(result.task!.plan).toEqual(['Step 1', 'Step 2']);
    });

    it('should create task with poll frequency', async () => {
      const result = await TasksService.createTask(testUsername, {
        title: 'Polling Task',
        originalRequest: 'Test',
        plan: ['Step 1'],
        pollFrequency: { type: 'interval', value: 60000, label: '1 minute' }
      });

      expect(result.ok).toBe(true);
      expect(result.task!.pollFrequency.value).toBe(60000);
    });
  });

  describe('updateTask', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.updateTask('test-task', { status: 'active' }, null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should update task fields', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task to Update',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.updateTask(taskId, {
        status: 'active',
        hidden: true
      }, testUsername);

      expect(result.ok).toBe(true);
      expect(result.task!.status).toBe('active');
      expect(result.task!.hidden).toBe(true);
    });
  });

  describe('cancelTask', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.cancelTask('test-task', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should cancel a task', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task to Cancel',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.cancelTask(taskId, testUsername);
      expect(result.ok).toBe(true);

      // Verify task is cancelled
      const getResult = await TasksService.getTask(taskId, testUsername);
      expect(getResult.task!.status).toBe('cancelled');
    });
  });

  describe('hideTask', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.hideTask('test-task', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should hide a task', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task to Hide',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.hideTask(taskId, testUsername);
      expect(result.ok).toBe(true);

      // Verify task is hidden
      const getResult = await TasksService.getTask(taskId, testUsername);
      expect(getResult.task!.hidden).toBe(true);
    });
  });

  describe('getRawMarkdown', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.getRawMarkdown('test-task', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should get raw markdown for task', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Markdown Task',
        plan: ['Step 1', 'Step 2']
      });

      const taskId = created.task!.id;

      const result = await TasksService.getRawMarkdown(taskId, testUsername);

      expect(result.ok).toBe(true);
      expect(result.markdown).toBeDefined();
      expect(typeof result.markdown).toBe('string');
      expect(result.markdown).toContain('Markdown Task');
    });
  });

  describe('saveRawMarkdown', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.saveRawMarkdown('test-task', '# Test', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should save raw markdown for task', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task to Edit',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      // Get original markdown
      const original = await TasksService.getRawMarkdown(taskId, testUsername);

      // Modify it
      const modified = original.markdown!.replace('Task to Edit', 'Modified Task');

      const result = await TasksService.saveRawMarkdown(taskId, modified, testUsername);
      expect(result.ok).toBe(true);

      // Verify it was saved
      const updated = await TasksService.getRawMarkdown(taskId, testUsername);
      expect(updated.markdown).toContain('Modified Task');
    });
  });

  describe('setAutoSend', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.setAutoSend('test-task', true, null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should set auto-send to true', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.setAutoSend(taskId, true, testUsername);
      expect(result.ok).toBe(true);

      // Verify it was saved
      const getResult = await TasksService.getTask(taskId, testUsername);
      expect(getResult.task!.autoSend).toBe(true);
    });
  });

  describe('setPollFrequency', () => {
    it('should return error when not logged in', async () => {
      const result = await TasksService.setPollFrequency('test-task', 'hourly', null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should set poll frequency from preset key', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.setPollFrequency(taskId, '1hour', testUsername);
      expect(result.ok).toBe(true);
      expect(result.pollFrequency).toBeDefined();
      expect(result.pollFrequency.type).toBe('preset');

      // Verify it was saved
      const getResult = await TasksService.getTask(taskId, testUsername);
      expect(getResult.task!.pollFrequency.type).toBe('preset');
    });

    it('should reject invalid preset key', async () => {
      const created = await TasksService.createTask(testUsername, {
        title: 'Task',
        plan: ['Step 1']
      });

      const taskId = created.task!.id;

      const result = await TasksService.setPollFrequency(taskId, 'invalid_preset', testUsername);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid poll frequency preset');
    });
  });

  describe('getUpdates', () => {
    it('should return task updates', () => {
      const result = TasksService.getUpdates();

      expect(result.ok).toBe(true);
      expect(result.updates).toBeDefined();
      expect(Array.isArray(result.updates)).toBe(true);
    });
  });

  describe('getPollFrequencyPresets', () => {
    it('should return poll frequency presets', () => {
      const result = TasksService.getPollFrequencyPresets();

      expect(result.ok).toBe(true);
      expect(result.presets).toBeDefined();
      expect(typeof result.presets).toBe('object');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete task lifecycle', async () => {
      // 1. Create task
      const created = await TasksService.createTask(testUsername, {
        title: 'Lifecycle Task',
        originalRequest: 'Do all the things',
        plan: ['Step 1', 'Step 2', 'Step 3']
      });

      expect(created.ok).toBe(true);
      const taskId = created.task!.id;

      // 2. List tasks (should have 1)
      let list = await TasksService.listTasks(testUsername);
      expect(list.tasks).toHaveLength(1);

      // 3. Update task to active
      await TasksService.updateTask(taskId, { status: 'active' }, testUsername);

      // 4. Set preferences
      await TasksService.setAutoSend(taskId, true, testUsername);
      await TasksService.setPollFrequency(taskId, 'daily', testUsername);

      // 5. Get task and verify all changes
      const getResult = await TasksService.getTask(taskId, testUsername);
      expect(getResult.task!.status).toBe('active');
      expect(getResult.task!.autoSend).toBe(true);
      expect(getResult.task!.pollFrequency.type).toBe('preset');

      // 6. Cancel task
      await TasksService.cancelTask(taskId, testUsername);

      // 7. Verify cancelled
      const cancelled = await TasksService.getTask(taskId, testUsername);
      expect(cancelled.task!.status).toBe('cancelled');

      // 8. Hide task
      await TasksService.hideTask(taskId, testUsername);

      // 9. Verify hidden
      const hidden = await TasksService.getTask(taskId, testUsername);
      expect(hidden.task!.hidden).toBe(true);
    });
  });
});
