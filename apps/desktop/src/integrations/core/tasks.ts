/**
 * Tasks Integration
 *
 * Provides autonomous background task management:
 * - Create tasks with step-by-step plans
 * - List all tasks with their status
 * - Cancel running tasks
 *
 * Tasks execute independently in the background, handling multi-step
 * workflows like scheduling meetings, sending messages, or gathering information.
 */

import { Integration, Tool, IntegrationContext } from '../base';
import { createTask, listTasks, cancelTask, CreateTaskData, Task } from '../../tasks';
import { TutorialService } from '../../services/TutorialService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CreateTaskInput {
  title: string;
  originalRequest: string;
  messagingChannel: 'imessage' | 'email' | 'slack' | 'telegram' | 'discord' | 'x';
  plan: string[];
  context?: Record<string, any>;
}

interface CancelTaskInput {
  taskId: string;
}

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  lastUpdated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const taskTools: Tool[] = [
  {
    name: 'create_task',
    description:
      "IMPORTANT: Only call this AFTER the user has explicitly confirmed they want to create the task. Do NOT call this immediately - first describe your proposed plan in plain text and ask 'Would you like me to create this task?' Then WAIT for the user to say yes/confirm/go ahead before calling this tool. This creates an autonomous background task that runs independently. CRITICAL: When you call create_task, do NOT also call send_email, send_imessage, or any other action tool - the task executor will handle ALL steps automatically. If you send a message AND create a task, duplicate messages will be sent.",
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: "Short descriptive title for the task (e.g., 'Schedule lunch with Jeff')",
        },
        originalRequest: {
          type: 'string',
          description: "The user's original request verbatim - copy exactly what they said",
        },
        messagingChannel: {
          type: 'string',
          enum: ['imessage', 'email', 'slack', 'telegram', 'discord', 'x'],
          description:
            "REQUIRED: Which messaging channel to use. Detect from keywords in user's request: 'text'/'message'/'sms' = imessage, 'email'/'mail' = email, 'slack' = slack, 'telegram' = telegram, 'discord' = discord, 'tweet'/'x'/'twitter' = x",
        },
        plan: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Step-by-step plan to accomplish the task. Be specific about what each step does.',
        },
        context: {
          type: 'object',
          description:
            'Key context needed for the task - emails, names, durations, dates, etc. Store anything the task needs to remember.',
        },
      },
      required: ['title', 'originalRequest', 'messagingChannel', 'plan'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all existing tasks with their current status.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel an existing task by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to cancel',
        },
      },
      required: ['taskId'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeTaskTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  try {
    const username = context.currentUser?.username;

    if (!username) {
      return { error: 'User not authenticated' };
    }

    switch (toolName) {
      case 'create_task': {
        const input = toolInput as CreateTaskInput;

        // Create the task using the task storage module
        const task = await createTask(input as CreateTaskData, username);

        // Check if we should advance onboarding from task_demo to skill_demo
        let tutorialMessage = '';
        const taskAdvanced = await TutorialService.checkTaskCreationAdvancement(username);
        if (taskAdvanced) {
          tutorialMessage = '\n\n' + TutorialService.getSkillDemoPromptMessage();
        }

        // Send initial notification that task is starting
        if (context.mainWindow?.webContents) {
          context.mainWindow.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: `🚀 **Task Started: ${task.title}**\n\nExecuting step 1: ${task.plan[0] || 'Starting...'}`,
            source: 'task',
          });
        }

        // Auto-start the task immediately (don't await - let it run in background)
        // Note: executeTaskStep is injected at runtime in main.js
        if (context.executeTaskStep) {
          setTimeout(async () => {
            console.log(`[Tasks] Auto-starting task: ${task.id}`);
            await context.executeTaskStep(task.id, username);
          }, 100);
        } else {
          console.warn('[Tasks] executeTaskStep not available in context');
        }

        return {
          success: true,
          taskId: task.id,
          message: `Task "${task.title}" created and started! The first step is now executing.${tutorialMessage}`,
          plan: task.plan,
        };
      }

      case 'list_tasks': {
        const tasks = await listTasks(username);

        const taskSummaries: TaskSummary[] = tasks.map((t: Task) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          currentStep: t.currentStep.step,
          totalSteps: t.plan.length,
          lastUpdated: t.lastUpdated,
        }));

        return {
          tasks: taskSummaries,
        };
      }

      case 'cancel_task': {
        const input = toolInput as CancelTaskInput;
        const result = await cancelTask(input.taskId, username);

        if (result.error) {
          return { error: result.error };
        }

        return {
          success: true,
          message: 'Task cancelled successfully',
        };
      }

      default:
        return { error: `Unknown task tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Tasks] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const tasksIntegration: Integration = {
  name: 'tasks',
  category: 'core',
  tools: taskTools,
  execute: executeTaskTool,

  // Tasks are always available - no authentication needed
  isAvailable: async () => true,
};
