/**
 * Time Integration
 *
 * Provides time and reminder functionality.
 * Always available - no authentication required.
 *
 * Features:
 * - Get current time with timezone support
 * - Send reminder messages to chat
 */

import { Integration, Tool, IntegrationContext } from '../base';
import {
  executeTimeTool as executeTimeToolImpl,
  GetCurrentTimeInput,
  SendReminderInput,
  type ToolContext,
} from '../../tools/time';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: 'get_current_time',
    description:
      "Get the current date and time. Use this to check if it's time for a scheduled action. Returns hour (0-23), minute (0-59), and formatted time string.",
    input_schema: {
      type: 'object' as const,
      properties: {
        timezone: {
          type: 'string',
          description: "Timezone (e.g., 'America/New_York'). Defaults to local timezone.",
        },
      },
      required: [],
    },
  },
  {
    name: 'send_reminder',
    description:
      'Send a reminder message to the user in the chat. Use this for time-based reminders and notifications.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The reminder message to display to the user',
        },
      },
      required: ['message'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeTimeTool(
  toolName: string,
  toolInput: GetCurrentTimeInput | SendReminderInput,
  context: IntegrationContext
): Promise<any> {
  console.log(`[Time Integration] Executing ${toolName} with input:`, JSON.stringify(toolInput));

  // Map IntegrationContext to ToolContext
  const toolContext: ToolContext = {
    mainWindow: context.mainWindow,
  };

  try {
    const result = await executeTimeToolImpl(toolName, toolInput, toolContext);
    return result;
  } catch (err: any) {
    console.error(`[Time Integration] Error executing ${toolName}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const timeIntegration: Integration = {
  name: 'time',
  category: 'core',
  tools,
  execute: executeTimeTool,
  // Always available - no authentication required
  isAvailable: async () => true,
};
