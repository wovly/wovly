/**
 * Asana Integration
 *
 * Provides task management capabilities through Asana's API.
 * Supports workspaces, projects, tasks, and task operations.
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const asanaTools: Tool[] = [
  {
    name: 'list_asana_workspaces',
    description: 'List Asana workspaces the user has access to.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_asana_projects',
    description: 'List projects in an Asana workspace.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Workspace ID' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'get_asana_tasks',
    description: 'Get tasks from an Asana project.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID' },
        completed: {
          type: 'boolean',
          description: 'Include completed tasks (default: false)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'create_asana_task',
    description: 'Create a task in Asana.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to add the task to',
        },
        name: { type: 'string', description: 'Task name' },
        notes: { type: 'string', description: 'Task description/notes' },
        due_on: {
          type: 'string',
          description: 'Due date (YYYY-MM-DD format)',
        },
        assignee: {
          type: 'string',
          description: 'Assignee user ID or email',
        },
      },
      required: ['project_id', 'name'],
    },
  },
  {
    name: 'update_asana_task',
    description: 'Update an existing Asana task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID' },
        name: { type: 'string', description: 'New task name' },
        notes: { type: 'string', description: 'New notes' },
        due_on: { type: 'string', description: 'New due date' },
        completed: {
          type: 'boolean',
          description: 'Mark as completed',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'complete_asana_task',
    description: 'Mark an Asana task as complete.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to complete' },
      },
      required: ['task_id'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an Asana tool with the provided input
 */
const executeAsanaTool = async (
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> => {
  const accessToken = context.accessTokens?.asana;

  if (!accessToken) {
    return {
      error: 'Asana not connected. Please set up Asana in the Integrations page.',
    };
  }

  const baseUrl = 'https://app.asana.com/api/1.0';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    switch (toolName) {
      case 'list_asana_workspaces': {
        const response = await fetch(`${baseUrl}/workspaces`, { headers });
        if (!response.ok) {
          return { error: 'Failed to list workspaces' };
        }
        const data = (await response.json()) as any;
        return {
          workspaces: data.data.map((w: any) => ({
            id: w.gid,
            name: w.name,
          })),
        };
      }

      case 'list_asana_projects': {
        const response = await fetch(`${baseUrl}/workspaces/${toolInput.workspace_id}/projects`, {
          headers,
        });
        if (!response.ok) {
          return { error: 'Failed to list projects' };
        }
        const data = (await response.json()) as any;
        return {
          projects: data.data.map((p: any) => ({
            id: p.gid,
            name: p.name,
          })),
        };
      }

      case 'get_asana_tasks': {
        const completed = toolInput.completed ? 'true' : 'false';
        const completedSince = completed === 'true' ? 'now' : '';
        const response = await fetch(
          `${baseUrl}/projects/${toolInput.project_id}/tasks?opt_fields=name,notes,due_on,completed,assignee.name&completed_since=${completedSince}`,
          { headers }
        );
        if (!response.ok) {
          return { error: 'Failed to get tasks' };
        }
        const data = (await response.json()) as any;
        return {
          tasks: data.data.map((t: any) => ({
            id: t.gid,
            name: t.name,
            notes: t.notes,
            due_on: t.due_on,
            completed: t.completed,
            assignee: t.assignee?.name,
          })),
        };
      }

      case 'create_asana_task': {
        const taskData: any = {
          name: toolInput.name,
          projects: [toolInput.project_id],
        };
        if (toolInput.notes) taskData.notes = toolInput.notes;
        if (toolInput.due_on) taskData.due_on = toolInput.due_on;
        if (toolInput.assignee) taskData.assignee = toolInput.assignee;

        const response = await fetch(`${baseUrl}/tasks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ data: taskData }),
        });
        if (!response.ok) {
          const err = (await response.json()) as any;
          return {
            error: err.errors?.[0]?.message || 'Failed to create task',
          };
        }
        const data = (await response.json()) as any;
        return {
          success: true,
          task_id: data.data.gid,
          name: data.data.name,
        };
      }

      case 'update_asana_task': {
        const taskData: any = {};
        if (toolInput.name) taskData.name = toolInput.name;
        if (toolInput.notes !== undefined) taskData.notes = toolInput.notes;
        if (toolInput.due_on) taskData.due_on = toolInput.due_on;
        if (toolInput.completed !== undefined) {
          taskData.completed = toolInput.completed;
        }

        const response = await fetch(`${baseUrl}/tasks/${toolInput.task_id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ data: taskData }),
        });
        if (!response.ok) {
          return { error: 'Failed to update task' };
        }
        return { success: true, message: 'Task updated' };
      }

      case 'complete_asana_task': {
        const response = await fetch(`${baseUrl}/tasks/${toolInput.task_id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ data: { completed: true } }),
        });
        if (!response.ok) {
          return { error: 'Failed to complete task' };
        }
        return { success: true, message: 'Task marked as complete' };
      }

      default:
        return { error: `Unknown Asana tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Asana] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const asanaIntegration: Integration = {
  name: 'asana',
  category: 'productivity',
  tools: asanaTools,
  execute: executeAsanaTool,
  isAvailable: async (context) => !!context.accessTokens?.asana,
};

export default asanaIntegration;
