/**
 * Time Tools - get_current_time and send_reminder
 */

import type { BrowserWindow } from 'electron';

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * get_current_time tool input
 */
export interface GetCurrentTimeInput {
  timezone?: string;
}

/**
 * send_reminder tool input
 */
export interface SendReminderInput {
  message: string;
}

/**
 * get_current_time result
 */
export interface GetCurrentTimeResult {
  success: true;
  timestamp: string;
  formatted: string;
  timezone: string;
  hour: number;
  minute: number;
  dayOfWeek: string;
}

/**
 * send_reminder result
 */
export interface SendReminderResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Tool executor context
 */
export interface ToolContext {
  mainWindow?: BrowserWindow;
}

// Time-related tools for task scheduling
export const timeTools: Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time. Use this to check if it's time for a scheduled action. Returns hour (0-23), minute (0-59), and formatted time string.",
    input_schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Timezone (e.g., 'America/New_York'). Defaults to local timezone."
        }
      },
      required: []
    }
  },
  {
    name: "send_reminder",
    description: "Send a reminder message to the user in the chat. Use this for time-based reminders and notifications.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The reminder message to display to the user"
        }
      },
      required: ["message"]
    }
  }
];

/**
 * Execute time-related tools
 */
export async function executeTimeTool(
  toolName: string,
  toolInput: GetCurrentTimeInput | SendReminderInput,
  context: ToolContext = {}
): Promise<GetCurrentTimeResult | SendReminderResult> {
  const { mainWindow } = context;

  switch (toolName) {
    case "get_current_time": {
      const input = toolInput as GetCurrentTimeInput;
      const now = new Date();
      const timezone = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      return {
        success: true,
        timestamp: now.toISOString(),
        formatted: formatter.format(now),
        timezone: timezone,
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' })
      };
    }

    case "send_reminder": {
      const input = toolInput as SendReminderInput;
      const message = input.message;

      if (!message) {
        return { success: false, error: "No message provided" };
      }

      // Send to main chat window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("chat:newMessage", {
          role: "assistant",
          content: `⏰ **Reminder**\n\n${message}`,
          source: "reminder"
        });
      }

      console.log(`[Reminder] Sent: ${message}`);
      return { success: true, message: "Reminder sent to user" };
    }

    default:
      return { success: false, error: `Unknown time tool: ${toolName}` };
  }
}
