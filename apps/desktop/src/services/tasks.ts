/**
 * Tasks Service
 * Handles task CRUD operations and preference management
 */

import { promises as fs } from 'fs';
import path from 'path';

// Import task storage functions and types
import {
  getTasksDir,
  parseTaskMarkdown,
  serializeTask,
  getTask,
  updateTask,
  cancelTask,
  hideTask,
  getTaskRawMarkdown,
  saveTaskRawMarkdown,
  getTaskUpdates,
  POLL_FREQUENCY_PRESETS,
  DEFAULT_POLL_FREQUENCY,
  type Task
} from '../tasks';

/**
 * Service response with task data
 */
export interface TasksResponse {
  ok: boolean;
  task?: Task;
  tasks?: Task[];
  markdown?: string;
  updates?: any[];
  presets?: any;
  pollFrequency?: any;
  error?: string;
}

/**
 * Task creation data - matches CreateTaskData from storage layer
 */
export interface TaskCreateData {
  title?: string;
  originalRequest?: string;
  plan?: string[];
  structuredPlan?: any[];
  taskType?: 'discrete' | 'continuous';
  task_type?: 'discrete' | 'continuous';
  pollFrequency?: string | any;
  messagingChannel?: string;
  context?: Record<string, string>;
  successCriteria?: string;
  success_criteria?: string;
  monitoringCondition?: string;
  monitoring_condition?: string;
  triggerAction?: string;
  trigger_action?: string;
}

/**
 * TasksService - Manages user tasks
 */
export class TasksService {
  /**
   * List all tasks for user
   * @param username - Current username
   * @returns List of tasks or empty array
   */
  static async listTasks(username: string | null | undefined): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: true, tasks: [] };
      }

      const { listTasks } = require('../tasks');
      const tasks = await listTasks(username);
      return { ok: true, tasks };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get a specific task by ID
   * @param taskId - Task ID
   * @param username - Current username
   * @returns Task object
   */
  static async getTask(
    taskId: string,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      return { ok: true, task };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Create a new task
   * @param username - Current username
   * @param taskData - Task creation data
   * @returns Created task object
   */
  static async createTask(
    username: string | null | undefined,
    taskData: TaskCreateData
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const { createTask } = require('../tasks');
      const task = await createTask(taskData, username);

      return { ok: true, task };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Update a task
   * @param taskId - Task ID
   * @param updates - Fields to update
   * @param username - Current username
   * @returns Updated task object
   */
  static async updateTask(
    taskId: string,
    updates: any,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await updateTask(taskId, updates, username);
      if ('error' in result) {
        return { ok: false, error: result.error };
      }

      return { ok: true, task: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Cancel a task
   * @param taskId - Task ID
   * @param username - Current username
   * @returns Success/error response
   */
  static async cancelTask(
    taskId: string,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await cancelTask(taskId, username);
      if (result.error) {
        return { ok: false, error: result.error };
      }

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Hide a task
   * @param taskId - Task ID
   * @param username - Current username
   * @returns Success/error response
   */
  static async hideTask(
    taskId: string,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await hideTask(taskId, username);
      if (result.error) {
        return { ok: false, error: result.error };
      }

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get raw markdown for a task
   * @param taskId - Task ID
   * @param username - Current username
   * @returns Raw markdown content
   */
  static async getRawMarkdown(
    taskId: string,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await getTaskRawMarkdown(taskId, username);
      if (typeof result === 'object' && 'error' in result) {
        return { ok: false, error: result.error };
      }

      return { ok: true, markdown: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Save raw markdown for a task
   * @param taskId - Task ID
   * @param markdown - Markdown content
   * @param username - Current username
   * @returns Success/error response
   */
  static async saveRawMarkdown(
    taskId: string,
    markdown: string,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const result = await saveTaskRawMarkdown(taskId, markdown, username);
      if (result.error) {
        return { ok: false, error: result.error };
      }

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Set auto-send preference for a task
   * @param taskId - Task ID
   * @param autoSend - Enable/disable auto-send
   * @param username - Current username
   * @returns Success/error response
   */
  static async setAutoSend(
    taskId: string,
    autoSend: boolean,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      task.autoSend = autoSend;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Auto-send ${autoSend ? 'enabled' : 'disabled'}`
      });

      // Save task
      const tasksDir = await getTasksDir(username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Set notifications disabled preference for a task
   * @param taskId - Task ID
   * @param disabled - Enable/disable notifications
   * @param username - Current username
   * @returns Success/error response
   */
  static async setNotificationsDisabled(
    taskId: string,
    disabled: boolean,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      // Use type assertion since notificationsDisabled exists at runtime but not in type
      (task as any).notificationsDisabled = disabled;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Notifications ${disabled ? 'disabled' : 'enabled'}`
      });

      // Save task
      const tasksDir = await getTasksDir(username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), 'utf8');

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Set poll frequency for a task
   * @param taskId - Task ID
   * @param pollFrequency - Poll frequency (preset key or object)
   * @param username - Current username
   * @returns Success/error response with poll frequency
   */
  static async setPollFrequency(
    taskId: string,
    pollFrequency: string | any,
    username: string | null | undefined
  ): Promise<TasksResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      // Parse poll frequency - can be a preset key or full object
      let newPollFrequency: any;
      if (typeof pollFrequency === 'string') {
        if (POLL_FREQUENCY_PRESETS[pollFrequency]) {
          newPollFrequency = { ...POLL_FREQUENCY_PRESETS[pollFrequency] };
        } else {
          return { ok: false, error: 'Invalid poll frequency preset' };
        }
      } else if (
        typeof pollFrequency === 'object' &&
        pollFrequency.type &&
        pollFrequency.value
      ) {
        newPollFrequency = pollFrequency;
      } else {
        return { ok: false, error: 'Invalid poll frequency format' };
      }

      task.pollFrequency = newPollFrequency;
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Poll frequency changed to: ${newPollFrequency.label}`
      });

      // Update nextCheck based on the new poll frequency
      if (newPollFrequency.type === 'event') {
        // For event-based tasks, clear nextCheck since they don't poll on interval
        task.nextCheck = null;
      } else {
        // Always recalculate nextCheck when user explicitly changes frequency
        // Schedule next check from NOW based on new interval
        task.nextCheck = Date.now() + newPollFrequency.value;
      }

      // Save task
      const tasksDir = await getTasksDir(username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), 'utf8');

      return { ok: true, pollFrequency: newPollFrequency };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get task updates (for UI notification queue)
   * @returns Task updates array
   */
  static getUpdates(): TasksResponse {
    try {
      const updates = getTaskUpdates();
      return { ok: true, updates };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get available poll frequency presets
   * @returns Poll frequency presets object
   */
  static getPollFrequencyPresets(): TasksResponse {
    return { ok: true, presets: POLL_FREQUENCY_PRESETS };
  }
}
